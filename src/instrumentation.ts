/** Al arrancar el servidor, inicia la cola y reanuda trabajos interrumpidos. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/queue");
    startWorker();
  }
}
