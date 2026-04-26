import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// Local-disk artifact store. v1 only — production swaps in S3 behind the same
// interface. Returned URLs are relative file:// paths the dashboard can serve
// via a static handler (or, in dev, you can open the file directly).
export class ArtifactStore {
  constructor(private readonly root: string) {}

  static fromEnv(): ArtifactStore {
    const dir = process.env.ARTIFACT_DIR ?? "./.scan-artifacts";
    return new ArtifactStore(resolve(dir));
  }

  async writePng(scanId: string, name: string, data: Buffer): Promise<string> {
    const path = join(this.root, scanId, `${name}.png`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return `file://${path}`;
  }
}
