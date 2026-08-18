<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { dotnet } from '_framework/dotnet';
import { Counter } from 'typeshim';

const count = ref(0);
let counter: Counter | undefined;

onMounted(async () => {
  const runtime = await dotnet.create();
  runtime.runMain();
  counter = new Counter(0);
  count.value = counter.Value;
});

function increment(): void {
  if (!counter) return;
  counter.Increment();
  count.value = counter.Value;
}
</script>

<template>
  <main class="mx-auto min-h-screen max-w-md px-6 py-16">
    <div class="rounded-xl bg-white p-8 ring-1 ring-stone-200">
      <p class="text-sm text-stone-500">Farm · Vue</p>
      <p class="mt-4 text-5xl font-light tabular-nums">{{ count }}</p>
      <button
        type="button"
        class="mt-6 rounded-full bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-900"
        @click="increment"
      >
        Increment
      </button>
    </div>
  </main>
</template>
