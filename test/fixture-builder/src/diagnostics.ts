export interface DiagnosticsHeader {
  bundler: string;
  platform: string;
  serveMode: string;
  kind: string;
  buildMode: string;
  projectName: string;
  dir: string;
  port: number;
  fingerprint: boolean | undefined;
}

/** Hidden process-log buffer. Collection is always on; printing is opt-in via enable(). */
export class FixtureDiagnostics {
  private readonly buildLogs: string[] = [];
  private readonly appLogs: string[] = [];
  private readonly devLogs: string[] = [];
  private readonly serverLogs: string[] = [];
  private printEnabled = false;
  private flushed = false;

  addBuildLog(output: string): void {
    this.buildLogs.push(output);
  }

  addAppLog(output: string): void {
    this.appLogs.push(output);
  }

  addDevLog(output: string): void {
    this.devLogs.push(output);
  }

  addServerLog(output: string): void {
    this.serverLogs.push(output);
  }

  /** Enable printing on flush. Collection is always on. Idempotent. */
  enable(): void {
    if (this.printEnabled) return;
    this.printEnabled = true;
  }

  flush(header: DiagnosticsHeader): void {
    if (!this.printEnabled || this.flushed) return;
    this.flushed = true;
    console.error(this.format(header));
  }

  private format(header: DiagnosticsHeader): string {
    const lines = [
      '--- fixture diagnostics ---',
      `bundler: ${header.bundler}`,
      `platform: ${header.platform}`,
      `serveMode: ${header.serveMode}`,
      `kind: ${header.kind}`,
      `buildMode: ${header.buildMode}`,
      `projectName: ${header.projectName}`,
      `dir: ${header.dir}`,
      `port: ${header.port}`,
      `fingerprint: ${header.fingerprint}`,
    ];
    for (const output of this.buildLogs) {
      lines.push('', '--- build ---', output);
    }
    for (const output of this.appLogs) {
      lines.push('', '--- app ---', output);
    }
    for (const output of this.devLogs) {
      lines.push('', '--- dev ---', output);
    }
    for (const output of this.serverLogs) {
      lines.push('', '--- server ---', output);
    }
    lines.push('', '--- end fixture diagnostics ---');
    return lines.join('\n');
  }
}
