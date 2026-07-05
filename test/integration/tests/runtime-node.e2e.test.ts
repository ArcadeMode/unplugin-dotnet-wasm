import { describe, test, expect, beforeAll } from 'vitest';

interface DotnetLib {
  greet(name: string): string;
  add(a: number, b: number): number;
  boolNot(value: boolean): boolean;
  pi(): number;
  incrementCounter(): number;
  delayThenEcho(value: string, delayMs: number): Promise<string>;
  boom(): void;
}

const throwErr = (msg: string): never => { throw new Error(msg); };
const currentBundler = process.env.BUNDLER ?? throwErr("BUNDLER environment variable is missing");
const currentShape = process.env.DOTNET_FIXTURE_SHAPE ?? throwErr("DOTNET_FIXTURE_SHAPE environment variable is missing");
const currentPlatform = process.env.PLATFORM ?? throwErr("PLATFORM environment variable is missing");

// Skip entire suite if not node platform or if shape is 'none'
const skipSuite = currentPlatform !== 'node' || currentShape === 'none';

describe(`[${currentBundler}][${currentShape}][${currentPlatform}] Node WASM runtime interop`, { skip: skipSuite }, () => {
  let lib: DotnetLib;

  beforeAll(async () => {
    // Use relative path - Vite/Node can resolve this without file:// protocol
    const entryPath = `../../fixtures/node/library-app-${currentBundler}/dist/entry.js`;
    
    try {
      const entryModule = await import(entryPath);
      lib = await entryModule.initializeLib();
    } catch (error) {
      throw new Error(`Failed to initialize lib from ${entryPath}: ${(error as Error).message}`);
    }
  });

  test('Echo.Greet returns greeting string', () => {
    const result = lib.greet('world');
    expect(result).toBe('Hello, world');
  });

  test('Echo.Add returns correct sum', () => {
    const result = lib.add(2, 3);
    expect(result).toBe(5);
  });

  test('Echo.BoolNot inverts boolean', () => {
    const t = lib.boolNot(true);
    const f = lib.boolNot(false);
    expect(t).toBe(false);
    expect(f).toBe(true);
  });

  test('Echo.Pi approximates Math.PI', () => {
    const result = lib.pi();
    expect(result).toBeCloseTo(Math.PI, 4);
  });

  test('Counter accumulates state across calls', () => {
    const v1 = lib.incrementCounter();
    const v2 = lib.incrementCounter();
    expect(typeof v1).toBe('number');
    expect(v2).toBe(v1 + 1);
  });

  test('AsyncOps.DelayThenEcho round-trips a string', async () => {
    const result = await lib.delayThenEcho('hello', 10);
    expect(result).toBe('hello');
  });

  test('Throws.Boom propagates a .NET exception to JS', () => {
    expect(() => lib.boom()).toThrow();
  });
});
