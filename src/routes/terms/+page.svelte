<main>
  <h1 class="mb-2 text-2xl font-semibold">Cuanto Terms</h1>
  <p class="text-muted-foreground mb-8 text-sm">
    Vocabulary terms defined by Cuanto for use in data exports. These terms extend standard
    vocabularies (Darwin Core, Humboldt Extension) where no equivalent term exists.
  </p>

  <section id="surveyorCount" class="scroll-mt-16">
    <h2 class="mb-1 text-lg font-semibold">surveyorCount</h2>
    <dl class="border-border divide-border divide-y rounded border text-sm">
      <div class="flex gap-4 px-4 py-2">
        <dt class="text-muted-foreground w-32 shrink-0">IRI</dt>
        <dd>
          <a href="https://cuanto.bio/terms/surveyorCount" class="font-mono break-all underline">
            https://cuanto.bio/terms/surveyorCount
          </a>
        </dd>
      </div>
      <div class="flex gap-4 px-4 py-2">
        <dt class="text-muted-foreground w-32 shrink-0">Type</dt>
        <dd>integer</dd>
      </div>
      <div class="flex gap-4 px-4 py-2">
        <dt class="text-muted-foreground w-32 shrink-0">Definition</dt>
        <dd>
          The number of people who conducted the survey, including the observer who created the
          record.
        </dd>
      </div>
      <div class="flex gap-4 px-4 py-2">
        <dt class="text-muted-foreground w-32 shrink-0">Usage</dt>
        <dd>
          Used in DwC-DP survey exports. Combined with
          <span class="font-mono">eco:eventDurationValue</span> and
          <span class="font-mono">eco:eventDurationUnit</span> to compute
          <span class="font-mono">eco:samplingEffortValue</span> in person-hours.
        </dd>
      </div>
    </dl>
  </section>
</main>
