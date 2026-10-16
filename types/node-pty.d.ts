/**
 * Types for `node-pty`, which is an optional dependency: it needs a native build
 * (node-gyp + a C++ toolchain) and the app deliberately keeps working without it —
 * `src/lib/terminal.ts` falls back to util-linux `script`. Because the package may be
 * absent at build time, its official .d.ts can't be relied on, so the small surface the
 * app actually uses is declared here. Kept byte-compatible with node-pty 1.x.
 */
declare module "node-pty" {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
    encoding?: string | null;
    handleFlowControl?: boolean;
    flowControlPause?: string;
    flowControlResume?: string;
    useConpty?: boolean;
    conptyInheritCursor?: boolean;
  }

  export interface IExitEvent {
    exitCode: number;
    signal?: number;
  }

  export interface IDisposable {
    dispose(): void;
  }

  export interface IPty {
    readonly pid: number;
    readonly cols: number;
    readonly rows: number;
    readonly process: string;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    clear(): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
    onData(listener: (data: string) => void): IDisposable;
    onExit(listener: (event: IExitEvent) => void): IDisposable;
    onTitleChange(listener: (title: string) => void): IDisposable;
  }

  export function spawn(file: string, args: string | string[], options: IPtyForkOptions): IPty;
}
