// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { NoSvidError } from './error';

import { FileHandle, open } from 'fs/promises';
import { ParsedJwtSvid, SpiffeJwtClient } from './interface';

export class SpiffeHelper implements AsyncDisposable {
  private readonly handles = new Set<JwtSvidDiskHandle>();

  constructor(private readonly spiffe: SpiffeJwtClient) {}

  /**
   * Ensures that a JWT-SVID is available on disk at the given path. An error will be thrown if the file
   * already exists or cannot be created for other reasons. The file will be created with permissions `0600`.
   * The file is automatically updated once the JWT come close to expiration.
   *
   * The returned promise will resolve once the file is first created with the JWT-SVID.
   *
   * @example
   *
   * ```ts
   * declare const helper: SpiffeHelper;
   *
   * await helper.ensureJwtOnDisk('/tmp/svid.jwt', 'example.com/myservice');
   * // The file /tmp/svid.jwt now exists and contains a JWT-SVID for the audience 'example.com/myservice'.
   * ```
   *
   * @throws {NoSvidError} if the API returns no SVIDs for the specified filter.
   */
  async ensureJwtOnDisk(
    path: string,
    audience: string | readonly string[],
    hint?: string,
  ): Promise<JwtSvidDiskHandle> {
    const svid = await this.spiffe.getJwtSvid(audience, hint);

    const file = await open(path, 'wx', 0o600);

    const handle = new JwtSvidDiskHandle(
      path,
      svid.spiffeId,
      typeof audience === 'string' ? audience : audience.join('|'),
      hint,
      file,
      this.spiffe,
    );

    try {
      await handle.start(svid);
    } catch (err) {
      await handle.close();
      throw err;
    }

    this.handles.add(handle);

    return handle;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.handles).map((handle) => handle.close()));
  }
}

export class JwtSvidDiskHandle implements AsyncDisposable {
  private timer?: NodeJS.Timeout;

  constructor(
    readonly path: string,
    public spiffeId: string,
    private readonly audience: string,
    private readonly hint: string | undefined,
    private readonly fileHandle: FileHandle,
    private readonly spiffe: SpiffeJwtClient,
  ) {}

  async start(initialSvid: ParsedJwtSvid): Promise<void> {
    await this.writeToDisk(initialSvid);
    this.scheduleRefresh(initialSvid);
  }

  private async writeToDisk(svid: ParsedJwtSvid): Promise<void> {
    await this.fileHandle.writeFile(svid.token, 'utf-8');
    await this.fileHandle.sync();
  }

  private scheduleRefresh(currentSvid: ParsedJwtSvid): void {
    const expiresInMs = currentSvid.expiresAtMs - Date.now();

    clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      void this.refresh();
    }, expiresInMs / 2);

    this.timer.unref();
  }

  private async refresh(): Promise<void> {
    const newSvid = await this.spiffe.getJwtSvid(this.audience, this.hint);

    await this.writeToDisk(newSvid);
    this.spiffeId = newSvid.spiffeId;

    this.scheduleRefresh(newSvid);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /**
   * Closes the file handle and stops any background processes related to keeping the file updated.
   */
  async close(): Promise<void> {
    clearTimeout(this.timer);
    await this.fileHandle.close();
  }
}
