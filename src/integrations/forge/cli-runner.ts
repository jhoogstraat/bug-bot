export interface CommandResult {
  exitCode: number;
  signalCode: string | number | null;
  stdout: string;
  stderr: string;
}

export class CLI {
  constructor(private readonly executable: string) { }

  async run(args: string[], cwd: string, timeoutMs = 30 * 60_000): Promise<CommandResult> {
    const child = Bun.spawn({
      cmd: [this.executable, ...args],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
      env: {
        ...process.env,
        NO_COLOR: "1",
        GIT_TERMINAL_PROMPT: "0",
        GH_PROMPT_DISABLED: "1",
      },
      cwd: cwd
    });

    // Consume both streams concurrently to avoid blocking on full buffers.
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return {
      exitCode,
      signalCode: child.signalCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }
}
