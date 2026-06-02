# Cloud Temple Calculator Frontend

Prototype statique du front `calculator.cloud-temple.app`.

## Lancer

Depuis la racine `calculator` :

```bash
npm start
```

Le script libère d'abord les ports `8001` et `4173` si un ancien serveur écoute encore dessus, puis lance :

- backend : `http://127.0.0.1:8001`
- frontend : `http://127.0.0.1:4173`

Arrêter les deux serveurs : `Ctrl+C`.

Le front est volontairement sans dépendance : HTML, CSS et JavaScript natif. Il consomme l'API backend locale par défaut sur `http://127.0.0.1:8001`.

Si l'API n'est pas disponible, aucun faux catalogue n'est affiché : l'interface
montre une erreur explicite. L'état de synchronisation QuoteFlow est lu via
`/api/sync/status` et peut être déclenché manuellement depuis l'interface.

Pour cibler une autre API avant le chargement de `src/app.js` :

```html
<script>
  window.CALCULATOR_API_BASE = "https://calculator.example.com";
</script>
```
