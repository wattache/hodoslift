/** Un bundle de production ne doit JAMAIS parler à l'émulateur d'authentification.
 *
 *  `connectAuthEmulator` est conditionné à `VITE_AUTH_EMULATOR_HOST`, que Vite
 *  substitue statiquement — sans la variable, le bloc est éliminé. Ce garde-fou
 *  couvre le seul cas qui reste : quelqu'un lance `npm run build` dans un shell
 *  où la variable traîne encore, et publie un front qui authentifie contre un
 *  émulateur inexistant. L'échec au build vaut mieux que la découverte en prod.
 */
if (process.env.VITE_AUTH_EMULATOR_HOST) {
  console.error(
    '\n⛔ VITE_AUTH_EMULATOR_HOST est posée — refus de construire.\n' +
    "   Cette variable n'a de sens que pour les tests e2e locaux.\n",
  );
  process.exit(1);
}
