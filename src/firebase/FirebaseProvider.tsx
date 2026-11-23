import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  browserPopupRedirectResolver,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
  type UserCredential,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  firebaseConfig,
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './index';
import {
  buildCockpitPreferencesMutableFields,
  buildHostSnapshotMutableFields,
  buildPingSampleMutableFields,
  buildSpeedTestMutableFields,
  buildUserWorkspaceMutableFields,
  FIREBASE_SCHEMA_LIMITS,
  sanitizeBoundedString,
  sanitizeFirebaseId,
} from './schemas';
import { MetricsPayload, SpeedTestResult, ThemeMode } from '../types/telemetry';
import { getCanonicalVersion } from '../utils/version';

export interface SyncedPreferencesDoc {
  uid: string;
  theme: ThemeMode;
  locale: string;
  autoSync: boolean;
  updatedAt?: Timestamp | null;
}

export interface SyncedHostSnapshotDoc {
  uid: string;
  nodeId: string;
  hostname: string;
  appVersion: string;
  cpuPercent: number;
  ramPercent: number;
  gpuPercent: number;
  wanRxBps: number;
  wanTxBps: number;
  onlineDevices: number;
  healthStatus: 'healthy' | 'busy' | 'reconnecting';
  updatedAt?: Timestamp | null;
}

export interface SyncedSpeedTestDoc {
  uid: string;
  testId: string;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  packetLossPct: number;
  serverName: string;
  serverLocation: string;
  isp: string;
  hostname: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SyncedPingSampleDoc {
  uid: string;
  sampleId: string;
  hostname: string;
  targetId: string;
  targetIp: string;
  targetLabel: string;
  kind: 'gateway' | 'external' | 'dns';
  avgMs: number;
  minMs: number;
  maxMs: number;
  lastMs: number;
  jitterMs: number;
  lossPct: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface FirebaseAuthErrorState {
  code: string;
  message: string;
  hostname: string;
  isLoopbackIp: boolean;
  isUnauthorizedDomain: boolean;
  isPopupBlocked: boolean;
}

const AUTHORIZED_CLOUD_BRIDGE_URL =
  'https://ais-pre-qupjek7aieunjnqnr3nezb-829837265398.europe-west2.run.app';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  firestoreConnected: boolean;
  authPending: boolean;
  authError: FirebaseAuthErrorState | null;
  bridgeSessionCode: string | null;
  isBridgeMode: boolean;
  firebaseProjectId: string;
  syncingNow: boolean;
  autoSync: boolean;
  lastSyncAt: string | null;
  syncedPreferences: SyncedPreferencesDoc | null;
  syncedNodes: SyncedHostSnapshotDoc[];
  syncedSpeedtests: SyncedSpeedTestDoc[];
  syncedPingHistory: SyncedPingSampleDoc[];
  signInWithGoogle: () => Promise<boolean>;
  signInWithGoogleRedirect: () => Promise<boolean>;
  signInViaAuthorizedBridge: () => Promise<boolean>;
  signInWithGoogleToken: (rawCodeOrToken: string) => Promise<boolean>;
  clearAuthError: () => void;
  signOutFirebase: () => Promise<void>;
  setAutoSyncEnabled: (enabled: boolean, currentTheme: ThemeMode, currentLocale: string) => Promise<void>;
  syncPreferences: (next: { theme: ThemeMode; locale: string; autoSync?: boolean }) => Promise<void>;
  syncHostSnapshot: (metrics: MetricsPayload | null, isHealthy: boolean, connError: boolean) => Promise<void>;
  syncPingSnapshot: (metrics: MetricsPayload | null) => Promise<void>;
  syncSpeedTestRecord: (result: SpeedTestResult, hostname: string) => Promise<void>;
  deleteSyncedSpeedTestRecord: (testId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function tsToMillis(ts?: Timestamp | null): number {
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  return ts.toMillis();
}

function parseFirebaseAuthError(error: unknown): FirebaseAuthErrorState {
  const rawCode =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const rawMsg = error instanceof Error ? error.message : String(error || '');
  const code = rawCode || (rawMsg.includes('unauthorized-domain') ? 'auth/unauthorized-domain' : 'auth/error');
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const isLoopbackIp = hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  const isUnauthorizedDomain =
    code.includes('unauthorized-domain') || rawMsg.toLowerCase().includes('unauthorized-domain');
  const isPopupBlocked =
    code.includes('popup-blocked') ||
    code.includes('cancelled-popup-request') ||
    code.includes('operation-not-supported-in-this-environment') ||
    rawMsg.toLowerCase().includes('popup-blocked');
  return {
    code,
    message: rawMsg,
    hostname,
    isLoopbackIp,
    isUnauthorizedDomain,
    isPopupBlocked,
  };
}

function encodeBridgeSessionPayload(idToken?: string | null, accessToken?: string | null): string | null {
  if (!idToken && !accessToken) return null;
  try {
    return btoa(
      JSON.stringify({
        type: 'RECURSOS_FIREBASE_GOOGLE_CREDENTIAL',
        idToken: idToken || null,
        accessToken: accessToken || null,
        ts: Date.now(),
      })
    );
  } catch {
    return idToken || accessToken || null;
  }
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<FirebaseAuthErrorState | null>(null);
  const [bridgeSessionCode, setBridgeSessionCode] = useState<string | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [syncedPreferences, setSyncedPreferences] = useState<SyncedPreferencesDoc | null>(null);
  const [syncedNodes, setSyncedNodes] = useState<SyncedHostSnapshotDoc[]>([]);
  const [syncedSpeedtests, setSyncedSpeedtests] = useState<SyncedSpeedTestDoc[]>([]);
  const [syncedPingHistory, setSyncedPingHistory] = useState<SyncedPingSampleDoc[]>([]);

  const workspaceReadyUidRef = useRef<string | null>(null);
  const workspacePromiseRef = useRef<Promise<void> | null>(null);

  const isBridgeMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('firebase_auth_bridge') === '1';
  }, []);

  useEffect(() => {
    let active = true;
    void testConnection().then((ok) => {
      if (active) setFirestoreConnected(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const ensureWorkspaceReady = useCallback(
    async (activeUser: User, hostname = 'host'): Promise<void> => {
      if (!activeUser.emailVerified) return;
      if (workspaceReadyUidRef.current === activeUser.uid) return;
      if (workspacePromiseRef.current) {
        await workspacePromiseRef.current;
        return;
      }

      const task = (async () => {
        const userPath = `users/${activeUser.uid}`;
        const userRef = doc(db, 'users', activeUser.uid);
        const workspaceFields = buildUserWorkspaceMutableFields({
          displayName: activeUser.displayName || '',
          lastHostname: hostname,
          appVersion: getCanonicalVersion(),
        });

        let userExists = false;
        try {
          const snap = await getDoc(userRef);
          userExists = snap.exists();
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, userPath);
        }

        if (!userExists) {
          try {
            await setDoc(userRef, {
              uid: activeUser.uid,
              ...workspaceFields,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, userPath);
          }
        } else {
          try {
            await updateDoc(userRef, {
              ...workspaceFields,
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, userPath);
          }
        }

        // Isolated PII subcollection write (after parent workspace exists)
        if (activeUser.email) {
          const privPath = `users/${activeUser.uid}/private/account`;
          const privRef = doc(db, 'users', activeUser.uid, 'private', 'account');
          const safeEmail = sanitizeBoundedString(
            activeUser.email,
            FIREBASE_SCHEMA_LIMITS.EMAIL_MAX_LEN,
            'user@example.com'
          );
          let privExists = false;
          try {
            const pSnap = await getDoc(privRef);
            privExists = pSnap.exists();
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, privPath);
          }

          if (!privExists) {
            try {
              await setDoc(privRef, {
                uid: activeUser.uid,
                email: safeEmail,
                emailVerified: Boolean(activeUser.emailVerified),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.CREATE, privPath);
            }
          } else {
            try {
              await updateDoc(privRef, {
                email: safeEmail,
                emailVerified: Boolean(activeUser.emailVerified),
                updatedAt: serverTimestamp(),
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.UPDATE, privPath);
            }
          }
        }

        workspaceReadyUidRef.current = activeUser.uid;
      })();

      workspacePromiseRef.current = task;
      try {
        await task;
      } finally {
        workspacePromiseRef.current = null;
      }
    },
    []
  );

  const handleCredentialResult = useCallback(
    async (cred: UserCredential | null): Promise<boolean> => {
      if (!cred?.user) return false;
      setAuthError(null);
      setFirestoreConnected(true);
      try {
        const oauthCred = GoogleAuthProvider.credentialFromResult(cred);
        if (oauthCred && (oauthCred.idToken || oauthCred.accessToken)) {
          const encoded = encodeBridgeSessionPayload(oauthCred.idToken, oauthCred.accessToken);
          if (encoded) setBridgeSessionCode(encoded);
          if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
            const targetOrigin =
              new URLSearchParams(window.location.search).get('origin') || '*';
            window.opener.postMessage(
              {
                type: 'RECURSOS_FIREBASE_GOOGLE_CREDENTIAL',
                idToken: oauthCred.idToken || null,
                accessToken: oauthCred.accessToken || null,
                code: encoded,
              },
              targetOrigin
            );
          }
        }
      } catch {
        // Ignore credential extraction issues
      }
      try {
        await ensureWorkspaceReady(cred.user);
      } catch (wsErr) {
        console.warn('Firebase workspace bootstrap warning (user stays signed in):', wsErr);
      }
      return true;
    },
    [ensureWorkspaceReady]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        setAuthError(null);
        void ensureWorkspaceReady(nextUser).catch(() => {
          // Non-fatal background workspace init
        });
      } else {
        workspaceReadyUidRef.current = null;
        workspacePromiseRef.current = null;
        setSyncedPreferences(null);
        setSyncedNodes([]);
        setSyncedSpeedtests([]);
        setSyncedPingHistory([]);
      }
    });
    void getRedirectResult(auth, browserPopupRedirectResolver)
      .then((res) => {
        if (res?.user) {
          void handleCredentialResult(res);
        }
      })
      .catch((err) => {
        if (err) {
          console.warn('Firebase getRedirectResult warning:', err);
        }
      });
    return () => unsub();
  }, [ensureWorkspaceReady, handleCredentialResult]);

  // Listen for postMessage from Cloud Auth Bridge popup
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'RECURSOS_FIREBASE_GOOGLE_CREDENTIAL') return;
      const idToken = typeof data.idToken === 'string' && data.idToken ? data.idToken : null;
      const accessToken = typeof data.accessToken === 'string' && data.accessToken ? data.accessToken : null;
      if (!idToken && !accessToken) return;
      setAuthPending(true);
      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      void signInWithCredential(auth, credential)
        .then((cred) => handleCredentialResult(cred))
        .catch((err) => {
          setAuthError(parseFirebaseAuthError(err));
        })
        .finally(() => {
          setAuthPending(false);
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleCredentialResult]);

  // Attach real-time Firestore onSnapshot listeners ONLY when auth is ready & user is authenticated
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;

    const uid = user.uid;
    const prefPath = `users/${uid}/preferences/cockpit`;
    const nodesPath = `users/${uid}/nodes`;
    const speedtestsPath = `users/${uid}/speedtests`;

    const unsubPref = onSnapshot(
      doc(db, 'users', uid, 'preferences', 'cockpit'),
      (snap) => {
        if (!snap.exists()) {
          setSyncedPreferences(null);
          return;
        }
        const raw = snap.data() as Partial<SyncedPreferencesDoc>;
        const nextPref: SyncedPreferencesDoc = {
          uid: String(raw.uid || uid),
          theme: raw.theme === 'dark' ? 'dark' : 'light',
          locale: typeof raw.locale === 'string' ? raw.locale : 'es',
          autoSync: raw.autoSync !== false,
          updatedAt: raw.updatedAt ?? null,
        };
        setSyncedPreferences(nextPref);
        setAutoSync(nextPref.autoSync);
        setLastSyncAt(new Date().toLocaleTimeString());
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, prefPath);
      }
    );

    const unsubNodes = onSnapshot(
      query(collection(db, 'users', uid, 'nodes'), where('uid', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as SyncedHostSnapshotDoc)
          .sort((a, b) => tsToMillis(b.updatedAt) - tsToMillis(a.updatedAt));
        setSyncedNodes(list);
        setLastSyncAt(new Date().toLocaleTimeString());
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, nodesPath);
      }
    );

    const unsubSpeedtests = onSnapshot(
      query(collection(db, 'users', uid, 'speedtests'), where('uid', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as SyncedSpeedTestDoc)
          .sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt));
        setSyncedSpeedtests(list);
        setLastSyncAt(new Date().toLocaleTimeString());
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, speedtestsPath);
      }
    );

    const pingHistoryPath = `users/${uid}/pingHistory`;
    const unsubPingHistory = onSnapshot(
      query(collection(db, 'users', uid, 'pingHistory'), where('uid', '==', uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as SyncedPingSampleDoc)
          .sort((a, b) => tsToMillis(b.createdAt) - tsToMillis(a.createdAt));
        setSyncedPingHistory(list);
        setLastSyncAt(new Date().toLocaleTimeString());
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, pingHistoryPath);
      }
    );

    return () => {
      unsubPref();
      unsubNodes();
      unsubSpeedtests();
      unsubPingHistory();
    };
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    setAuthPending(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
      return await handleCredentialResult(cred);
    } catch (error) {
      if (auth.currentUser) {
        try {
          await ensureWorkspaceReady(auth.currentUser);
        } catch {
          // ignore
        }
        return true;
      }
      const parsed = parseFirebaseAuthError(error);
      setAuthError(parsed);
      console.error('Firebase Google Sign-In error:', error);
      // If popup was blocked on an already-authorized domain, automatically try redirect
      if (parsed.isPopupBlocked && !parsed.isUnauthorizedDomain) {
        try {
          await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
          return true;
        } catch (redirErr) {
          setAuthError(parseFirebaseAuthError(redirErr));
        }
      }
      return false;
    } finally {
      setAuthPending(false);
    }
  }, [ensureWorkspaceReady, handleCredentialResult]);

  const signInWithGoogleRedirect = useCallback(async (): Promise<boolean> => {
    setAuthPending(true);
    setAuthError(null);
    try {
      await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
      return true;
    } catch (error) {
      setAuthError(parseFirebaseAuthError(error));
      return false;
    } finally {
      setAuthPending(false);
    }
  }, []);

  const signInViaAuthorizedBridge = useCallback(async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    // If on 127.0.0.1, localhost is already authorized by Firebase on the exact same machine
    if (window.location.hostname === '127.0.0.1') {
      const nextUrl = new URL(window.location.href);
      nextUrl.hostname = 'localhost';
      nextUrl.searchParams.set('view', 'mas');
      window.location.href = nextUrl.toString();
      return true;
    }
    const bridgeUrl = new URL(AUTHORIZED_CLOUD_BRIDGE_URL);
    bridgeUrl.searchParams.set('view', 'mas');
    bridgeUrl.searchParams.set('firebase_auth_bridge', '1');
    bridgeUrl.searchParams.set('origin', window.location.origin);
    const a = document.createElement('a');
    a.href = bridgeUrl.toString();
    a.target = '_blank';
    a.rel = 'opener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }, []);

  const signInWithGoogleToken = useCallback(
    async (rawCodeOrToken: string): Promise<boolean> => {
      const trimmed = String(rawCodeOrToken || '').trim();
      if (!trimmed) return false;
      setAuthPending(true);
      setAuthError(null);
      try {
        let idToken: string | null = null;
        let accessToken: string | null = null;
        try {
          const decoded = trimmed.startsWith('{') ? trimmed : atob(trimmed);
          const parsed = JSON.parse(decoded) as { idToken?: string | null; accessToken?: string | null };
          idToken = parsed.idToken || null;
          accessToken = parsed.accessToken || null;
        } catch {
          if (trimmed.split('.').length === 3) {
            idToken = trimmed;
          } else {
            accessToken = trimmed;
          }
        }
        if (!idToken && !accessToken) {
          throw new Error('Invalid Google session token');
        }
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        const cred = await signInWithCredential(auth, credential);
        return await handleCredentialResult(cred);
      } catch (error) {
        setAuthError(parseFirebaseAuthError(error));
        return false;
      } finally {
        setAuthPending(false);
      }
    },
    [handleCredentialResult]
  );

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  const signOutFirebase = useCallback(async () => {
    setAuthPending(true);
    try {
      await signOut(auth);
      setBridgeSessionCode(null);
      setAuthError(null);
    } finally {
      setAuthPending(false);
    }
  }, []);

  const syncPreferences = useCallback(
    async (next: { theme: ThemeMode; locale: string; autoSync?: boolean }) => {
      if (!authReady || !user || !user.emailVerified) return;
      await ensureWorkspaceReady(user);
      const path = `users/${user.uid}/preferences/cockpit`;
      const ref = doc(db, 'users', user.uid, 'preferences', 'cockpit');
      const payload = buildCockpitPreferencesMutableFields({
        theme: next.theme,
        locale: next.locale,
        autoSync: next.autoSync ?? autoSync,
      });

      let exists = false;
      try {
        const snap = await getDoc(ref);
        exists = snap.exists();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }

      if (!exists) {
        try {
          await setDoc(ref, {
            uid: user.uid,
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      } else {
        try {
          await updateDoc(ref, {
            ...payload,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      }
      setLastSyncAt(new Date().toLocaleTimeString());
    },
    [authReady, user, autoSync, ensureWorkspaceReady]
  );

  const setAutoSyncEnabled = useCallback(
    async (enabled: boolean, currentTheme: ThemeMode, currentLocale: string) => {
      setAutoSync(enabled);
      await syncPreferences({ theme: currentTheme, locale: currentLocale, autoSync: enabled });
    },
    [syncPreferences]
  );

  const syncHostSnapshot = useCallback(
    async (metrics: MetricsPayload | null, isHealthy: boolean, connError: boolean) => {
      if (!authReady || !user || !user.emailVerified || !metrics) return;
      const hostname = metrics.system?.hostname || 'host';
      const nodeId = sanitizeFirebaseId(hostname.toLowerCase(), 'primary_node');
      setSyncingNow(true);
      try {
        await ensureWorkspaceReady(user, hostname);
        const path = `users/${user.uid}/nodes/${nodeId}`;
        const ref = doc(db, 'users', user.uid, 'nodes', nodeId);
        const wanRx = metrics.wifi_summary?.router_wan_available
          ? metrics.wifi_summary?.router_wan_rx_bytes_sec ?? metrics.net?.wan_rx_bytes_sec ?? metrics.net?.rx_bytes_sec ?? 0
          : metrics.net?.wan_rx_bytes_sec ?? metrics.net?.rx_bytes_sec ?? 0;
        const wanTx = metrics.wifi_summary?.router_wan_available
          ? metrics.wifi_summary?.router_wan_tx_bytes_sec ?? metrics.net?.wan_tx_bytes_sec ?? metrics.net?.tx_bytes_sec ?? 0
          : metrics.net?.wan_tx_bytes_sec ?? metrics.net?.tx_bytes_sec ?? 0;
        const onlineDevices = (metrics.wifi_clients ?? []).filter(
          (c) => c.online !== false && c.is_online !== false
        ).length;

        const fields = buildHostSnapshotMutableFields({
          hostname,
          appVersion: getCanonicalVersion(),
          cpuPercent: metrics.cpu?.usage_percent ?? 0,
          ramPercent: metrics.ram?.percent ?? 0,
          gpuPercent: metrics.gpu?.gpu_util_percent ?? 0,
          wanRxBps: wanRx,
          wanTxBps: wanTx,
          onlineDevices,
          healthStatus: connError ? 'reconnecting' : isHealthy ? 'healthy' : 'busy',
        });

        let exists = false;
        try {
          const snap = await getDoc(ref);
          exists = snap.exists();
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
        }

        if (!exists) {
          try {
            await setDoc(ref, {
              uid: user.uid,
              nodeId,
              ...fields,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, path);
          }
        } else {
          try {
            await updateDoc(ref, {
              ...fields,
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, path);
          }
        }
        setLastSyncAt(new Date().toLocaleTimeString());
      } finally {
        setSyncingNow(false);
      }
    },
    [authReady, user, ensureWorkspaceReady]
  );

  const syncPingSnapshot = useCallback(
    async (metrics: MetricsPayload | null) => {
      const targets = metrics?.net?.ping_latency?.targets ?? [];
      if (!authReady || !user || !user.emailVerified || !metrics || targets.length === 0) return;
      const hostname = metrics.system?.hostname || 'host';
      await ensureWorkspaceReady(user, hostname);
      const minuteBucket = Math.floor(Date.now() / 60_000);

      for (const tgt of targets.slice(0, 5)) {
        const targetId = sanitizeFirebaseId(tgt.id || tgt.ip || 'target', 'target');
        const sampleId = sanitizeFirebaseId(`ping_${targetId}_${minuteBucket}`, `ping_${minuteBucket}`);
        const path = `users/${user.uid}/pingHistory/${sampleId}`;
        const ref = doc(db, 'users', user.uid, 'pingHistory', sampleId);
        const mutableFields = buildPingSampleMutableFields({
          hostname,
          targetIp: tgt.ip || '0.0.0.0',
          targetLabel: tgt.label || tgt.ip || targetId,
          kind: tgt.kind,
          avgMs: tgt.avg_ms ?? tgt.last_ms ?? 0,
          minMs: tgt.min_ms ?? tgt.last_ms ?? 0,
          maxMs: tgt.max_ms ?? tgt.last_ms ?? 0,
          lastMs: tgt.last_ms ?? tgt.avg_ms ?? 0,
          jitterMs: tgt.jitter_ms ?? 0,
          lossPct: tgt.loss_pct ?? 0,
        });

        let exists = false;
        try {
          const snap = await getDoc(ref);
          exists = snap.exists();
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, path);
        }

        if (!exists) {
          try {
            await setDoc(ref, {
              uid: user.uid,
              sampleId,
              targetId,
              ...mutableFields,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, path);
          }
        } else {
          try {
            await updateDoc(ref, {
              ...mutableFields,
              updatedAt: serverTimestamp(),
            });
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, path);
          }
        }
      }
      setLastSyncAt(new Date().toLocaleTimeString());
    },
    [authReady, user, ensureWorkspaceReady]
  );

  const syncSpeedTestRecord = useCallback(
    async (result: SpeedTestResult, hostname: string) => {
      if (!authReady || !user || !user.emailVerified) return;
      await ensureWorkspaceReady(user, hostname || 'host');
      const testId = sanitizeFirebaseId(`st_${result.id}_${Math.round(result.ts || Date.now() / 1000)}`, `st_${Date.now()}`);
      const path = `users/${user.uid}/speedtests/${testId}`;
      const ref = doc(db, 'users', user.uid, 'speedtests', testId);

      const fields = buildSpeedTestMutableFields({
        downloadMbps: result.download_mbps,
        uploadMbps: result.upload_mbps,
        pingMs: result.ping_ms,
        jitterMs: result.jitter_ms,
        packetLossPct: result.packet_loss_pct,
        serverName: result.server_name,
        serverLocation: result.server_location,
        isp: result.isp,
        hostname,
      });

      let exists = false;
      try {
        const snap = await getDoc(ref);
        exists = snap.exists();
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }

      if (!exists) {
        try {
          await setDoc(ref, {
            uid: user.uid,
            testId,
            ...fields,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      } else {
        try {
          await updateDoc(ref, {
            ...fields,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      }
      setLastSyncAt(new Date().toLocaleTimeString());
    },
    [authReady, user, ensureWorkspaceReady]
  );

  const deleteSyncedSpeedTestRecord = useCallback(
    async (rawTestId: string) => {
      if (!authReady || !user || !user.emailVerified) return;
      const testId = sanitizeFirebaseId(rawTestId, '');
      if (!testId) return;
      const path = `users/${user.uid}/speedtests/${testId}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'speedtests', testId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    },
    [authReady, user]
  );

  const value = useMemo<FirebaseContextValue>(
    () => ({
      user,
      authReady,
      firestoreConnected,
      authPending,
      authError,
      bridgeSessionCode,
      isBridgeMode,
      firebaseProjectId: firebaseConfig.projectId,
      syncingNow,
      autoSync,
      lastSyncAt,
      syncedPreferences,
      syncedNodes,
      syncedSpeedtests,
      syncedPingHistory,
      signInWithGoogle,
      signInWithGoogleRedirect,
      signInViaAuthorizedBridge,
      signInWithGoogleToken,
      clearAuthError,
      signOutFirebase,
      setAutoSyncEnabled,
      syncPreferences,
      syncHostSnapshot,
      syncPingSnapshot,
      syncSpeedTestRecord,
      deleteSyncedSpeedTestRecord,
    }),
    [
      user,
      authReady,
      firestoreConnected,
      authPending,
      authError,
      bridgeSessionCode,
      isBridgeMode,
      syncingNow,
      autoSync,
      lastSyncAt,
      syncedPreferences,
      syncedNodes,
      syncedSpeedtests,
      syncedPingHistory,
      signInWithGoogle,
      signInWithGoogleRedirect,
      signInViaAuthorizedBridge,
      signInWithGoogleToken,
      clearAuthError,
      signOutFirebase,
      setAutoSyncEnabled,
      syncPreferences,
      syncHostSnapshot,
      syncPingSnapshot,
      syncSpeedTestRecord,
      deleteSyncedSpeedTestRecord,
    ]
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
