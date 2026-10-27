/* ============================= INIT ============================= */
(async function init(){
  if(restoreSession()) await bootstrapCaches(); // a 401 here means the saved login has expired and logs out
  await renderApp();
})();
