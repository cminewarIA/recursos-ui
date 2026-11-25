import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {I18nProvider} from './i18n';
import {ThemeCatalogProvider} from './themes';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <ThemeCatalogProvider>
      <App />
    </ThemeCatalogProvider>
  </I18nProvider>
);
