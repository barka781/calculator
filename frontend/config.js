// Configuration runtime du frontend, chargée AVANT app.js.
//
// En développement : ce fichier est neutre. app.js garde donc son défaut
// (window.CALCULATOR_API_BASE absent → localStorage → http://127.0.0.1:8001),
// ce qui convient au lanceur `npm start` (front :4173, back :8001).
//
// En production (image Nginx) : ce fichier est masqué par une directive
// `location = /config.js` qui renvoie
//     window.CALCULATOR_API_BASE = window.location.origin;
// → l'API est appelée sur la même origine que le front (proxy Nginx),
//   sans CORS ni URL à configurer.
//
// Pour forcer une API distincte ici, décommenter et adapter :
// window.CALCULATOR_API_BASE = "https://mon-api.example";
