# @adventure/jobs

Define named asynchronous steps with `defineStep`, create a runner with `createJobs`, and use a `JobStore` for persistence. `memoryJobStore()` is useful for scripts and tests; `supabaseJobStore(serviceClient)` uses the service-role client and database RPCs.

```ts
const jobs = createJobs(memoryJobStore(), [
  defineStep("sources", async () => fetchSources()),
  defineStep("stageDetails", async ({ outputs }) => draftDetails(outputs.sources)),
  defineStep("personas", async ({ outputs }) => draftPersonas(outputs.sources)),
  defineStep("endings", async ({ outputs }) => draftEndings(outputs)),
]);

await jobs.enqueue(jobId, ["sources", "stageDetails", "personas", "endings"], {
  stageDetails: ["sources"],
  personas: ["sources"],
  endings: ["stageDetails", "personas"],
});
await jobs.drain({ jobId });
```

For a review pause, enqueue the first phase, wait for teacher review, then enqueue later steps on the same job with dependencies on the already-completed steps.
