import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {I18nProvider} from './i18n';
import {FirebaseProvider} from './firebase/FirebaseProvider';
import {FirestoreErrorBoundary} from './components/FirestoreErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <FirestoreErrorBoundary>
      <FirebaseProvider>
        <App />
      </FirebaseProvider>
    </FirestoreErrorBoundary>
  </I18nProvider>
);
