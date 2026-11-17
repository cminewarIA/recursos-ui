import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'build_deb/**/*', 'packages/**/*', 'static/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
