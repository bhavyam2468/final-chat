/* node-pty is an OPTIONAL native dependency (it needs a C toolchain and node headers to build, which is
   why the terminal falls back to util-linux `script` when it is missing — see src/lib/terminal.ts).
   Without this declaration `next build` fails to type-check on a machine where the optional package was
   not installed, even though the runtime path for that machine is fully supported. The surface below is
   exactly what the app uses; when node-pty IS installed its own types describe the same members. */
declare module "node-pty" {
  export type IPtyForkOptions = {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
    encoding?: string | null;
    handleFlowControl?: boolean;
    flowControlPause?: string;
    flowControlResume?: string;
    useConpty?: boolean;
  };
  export type IExitEvent = { exitCode: number; signal?: number };
  export type IPty = {
    pid: number;
    process: string;
    cols: number;
    rows: number;
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
    onData(listener: (data: string) => void): { dispose(): void };
    onExit(listener: (e: IExitEvent) => void): { dispose(): void };
  };
  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
}
