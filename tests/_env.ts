import os from "node:os";
import path from "node:path";
import fs from "node:fs";
// Cada ejecución de pruebas usa una carpeta de datos temporal y aislada.
process.env.PROFECIA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "profecia-test-"));
