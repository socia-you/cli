<script lang="ts">
  import { onMount } from 'svelte'
  import { socia } from '../shared/lib/socia'
  import { router } from '../shared/lib/router'
  import GlowBackground from '../widgets/GlowBackground.svelte'
  import HomePage from '../pages/home/HomePage.svelte'
  import AboutPage from '../pages/about/AboutPage.svelte'

  // Current route path. Updated whenever the router changes.
  let path = $state('/')

  onMount(() => {
    // Two-way binding between the host tab bar and the in-page router.
    //
    // 1. Host → app. When the user taps a tab, the host calls
    //    `socia.tabs._onHostChange(tabId)`, which fires our listener.
    const offTabs = socia.tabs.onChange((tabId) => {
      router.goto(`/${tabId}`)
    })

    // 2. App → host. When we navigate internally, we tell the host
    //    which tab should now be highlighted.
    const offRouter = router.onChange((next) => {
      path = next
      const tabId = next.replace(/^\//, '') || 'home'
      socia.tabs.setActive(tabId).catch(() => {
        // Fine to ignore: the host will not fail if the tab is unknown.
      })
    })

    // Kick off the router — reads the current hash and emits once.
    router.start()

    return () => {
      offTabs()
      offRouter()
    }
  })

  // Pick which page to render based on the current route.
  // Add more pages here as you grow the app.
  let Page = $derived.by(() => {
    if (path.startsWith('/about')) return AboutPage
    return HomePage
  })
</script>

<GlowBackground />

<main class="shell">
  <Page />
</main>

<style>
  .shell {
    position: relative;
    z-index: 1;
  }
</style>