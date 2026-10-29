import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { theme } from './lib/theme.svelte'
import { followOmarchyTheme, isDesktop, windowLabel } from './lib/native/desktop'
import { parseOmarchyColors } from './lib/omarchy'
import QuickAddWindow from './lib/native/QuickAddWindow.svelte'
import { setupDesktopMain } from './lib/native/setup'

theme.apply()
// On an Omarchy desktop, both windows take their colors from the desktop theme.
followOmarchyTheme((t) => theme.follow(t && parseOmarchyColors(t.id, t.colors)))

// Desktop app (Tauri): the floating quick-add window loads this same page with its own UI.
const quickAddWindow = isDesktop && windowLabel() === 'quickadd'
if (isDesktop && !quickAddWindow) setupDesktopMain()

const app = mount(quickAddWindow ? QuickAddWindow : App, {
  target: document.getElementById('app')!,
})

export default app
