import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

const runtime = await dotnet.create();
runtime.runMain();

const counter = new Counter(0);
counter.Increment();
console.log(`INCREMENT:${counter.Value}`);
counter.Increment();
console.log(`INCREMENT:${counter.Value}`);
