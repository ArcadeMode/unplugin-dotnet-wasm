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
  <button type="button" @click="increment">Increment</button>
  <p>
    Count: <span>{{ count }}</span>
  </p>
</template>
