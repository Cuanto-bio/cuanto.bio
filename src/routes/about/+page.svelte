<script lang="ts">
const title = 'About Cuanto';
</script>
<svelte:head>
  <title>{title}</title>
</svelte:head>

<main>
  <h1>{title}</h1>
  <p>
    Cuanto.bio is a tool for monitoring biodiversity by counting organisms. If you've ever used <a href="https://ebird.org">eBird</a> or participated in a <a href="https://en.wikipedia.org/wiki/Christmas_Bird_Count">Christmas Bird Count</a>, it's like that, except for any kind of organism. On Cuanto, however, anyone can make a protocol (say, "these 5 species of grasshopper in Istanbul") and anyone can complete surveys for that protocol.
  </p>

  <h2>Feedback</h2>
  <p>Please tell me what you think! You can make issues at <a href="https://userinput.app/#/s/did:plc:dd7efi6wormdpmcyscnkjc6n/3mquh7nnpd22t">Userinput.app</a>, <a href="https://tangled.org/cuanto.bio/cuanto.bio/issues">Tangled</a> or <a href="https://github.com/Cuanto-bio/cuanto.bio/issues">GitHub</a>, or just <a href="https://bsky.app/profile/cuanto.bio">mention or DM me on Bluesky</a>.</p>

  <h2>Who's doing this?</h2>
  <p>Right now, just me, <a href="https://kueda.net">Ken-ichi</a>. I also collaborate with <a href="https://rwell.org">Corey Farwell</a> on some of the data models used here and on <a href="https://observ.ing">observ.ing</a>.</p>

  <h2>Who's in charge?</h2>
  <p>Also just me, <a href="https://kueda.net">Ken-ichi</a>, though I'm happy to take this in a more democratic direction if the demos should appear.</p>

  <h2>How is it funded?</h2>
  <p>Initial funding was provided by the <a href="https://www.calacademy.org/community-science">Center for Biodiversity and Community Science</a> at the California Academy of Sciences, and I receive ongoing financial support from <a href="https://www.patreon.com/kueda">my patrons at Patreon</a>. Thank you to both! FWIW, hosting costs are currently low, though I'm still putting quite a bit of time into development and every bit helps.</p>

  <h2>Let's get nerdy</h2>
  <p>
    Cuanto.bio is built in the Atmosphere using the <a href="https://en.wikipedia.org/wiki/AT_Protocol">AT Protocol</a>. That means the data you add with Cuanto lives in your Personal Data Server (PDS) in the Atmosphere, so if another app in the Atmosphere wants to use it, they can! For example, when you observe species in a survey on Cuanto, those occurrence records show up on <a href="https://observ.ing/">observ.ing</a>. Cuanto.bio itself just holds on to copies of your data, but if it should disappear or you don't want to use it anymore, your data lives on in your PDS.
  </p>

  <p>This web app uses SvelteKit and Postgres and is entirely open source on <a href="https://tangled.org/cuanto.bio/cuanto.bio">Tangled</a> and <a href="https://github.com/Cuanto-bio/cuanto.bio">GitHub</a>.</p>

  <p>The data model is based on the Darwin Core Conceptual Model, particularly the Survey entity and its related entities, like Survey Target. Both the Cuanto.bio and lexicons.bio lexicons diverge slightly from the DwC-CM, but both should be able to produce a valid Darwin Core Data Package. For even more detail, <a href="/lexicons">check out the lexicons</a>.</p>
</main>
