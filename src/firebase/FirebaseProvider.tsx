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
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
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
  googleProvider,
  handleFirestoreError,
  OperationType,
  testConnection,
} from './index';
import {
  buildCockpitPreferencesMutableFields,
  buildHostSnapshotMutableFields,
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

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  firestoreConnected: boolean;
  authPending: boolean;
  syncingNow: boolean;
  autoSync: boolean;
  lastSyncAt: string | null;
  syncedPreferences: SyncedPreferencesDoc | null;
  syncedNodes: SyncedHostSnapshotDoc[];
  syncedSpeedtests: SyncedSpeedTestDoc[];
  signInWithGoogle: () => Promise<boolean>;
  signOutFirebase: () => Promise<void>;
  setAutoSyncEnabled: (enabled: boolean, currentTheme: ThemeMode, currentLocale: string) => Promise<void>;
  syncPreferences: (next: { theme: ThemeMode; locale: string; autoSync?: boolean }) => Promise<void>;
  syncHostSnapshot: (metrics: MetricsPayload | null, isHealthy: boolean, connError: boolean) => Promise<void>;
  syncSpeedTestRecord: (result: SpeedTestResult, hostname: string) => Promise<void>;
  deleteSyncedSpeedTestRecord: (testId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function tsToMillis(ts?: Timestamp | null): number {
  if (!ts || typeof ts.toMillis !== 'function') return 0;
  return ts.toMillis();
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [firestoreConnected, setFirestoreConnected] = useState(true);
  const [authPending, setAuthPending] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [syncedPreferences, setSyncedPreferences] = useState<SyncedPreferencesDoc | null>(null);
  const [syncedNodes, setSyncedNodes] = useState<SyncedHostSnapshotDoc[]>([]);
  const [syncedSpeedtests, setSyncedSpeedtests] = useState<SyncedSpeedTestDoc[]>([]);

  const workspaceReadyUidRef = useRef<string | null>(null);
  const workspacePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let active = true;
    void testConnection().then((ok) => {
      if (active) setFirestoreConnected(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        workspaceReadyUidRef.current = null;
        workspacePromiseRef.current = null;
        setSyncedPreferences(null);
        setSyncedNodes([]);
        setSyncedSpeedtests([]);
      }
    });
    return () => unsub();
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

    return () => {
      unsubPref();
      unsubNodes();
      unsubSpeedtests();
    };
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    setAuthPending(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        await ensureWorkspaceReady(cred.user);
      }
      setFirestoreConnected(true);
      return Boolean(cred.user);
    } catch (error) {
      console.error('Firebase Google Sign-In error:', error);
      return false;
    } finally {
      setAuthPending(false);
    }
  }, [ensureWorkspaceReady]);

  const signOutFirebase = useCallback(async () => {
    setAuthPending(true);
    try {
      await signOut(auth);
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
      syncingNow,
      autoSync,
      lastSyncAt,
      syncedPreferences,
      syncedNodes,
      syncedSpeedtests,
      signInWithGoogle,
      signOutFirebase,
      setAutoSyncEnabled,
      syncPreferences,
      syncHostSnapshot,
      syncSpeedTestRecord,
      deleteSyncedSpeedTestRecord,
    }),
    [
      user,
      authReady,
      firestoreConnected,
      authPending,
      syncingNow,
      autoSync,
      lastSyncAt,
      syncedPreferences,
      syncedNodes,
      syncedSpeedtests,
      signInWithGoogle,
      signOutFirebase,
      setAutoSyncEnabled,
      syncPreferences,
      syncHostSnapshot,
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
