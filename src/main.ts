import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { theme } from './lib/theme.svelte'
import { isDesktop, windowLabel } from './lib/native/desktop'
import QuickAddWindow from './lib/native/QuickAddWindow.svelte'
import { setupDesktopMain } from './lib/native/setup'

theme.apply()

// Desktop app (Tauri): the floating quick-add window loads this same page with its own UI.
const quickAddWindow = isDesktop && windowLabel() === 'quickadd'
if (isDesktop && !quickAddWindow) setupDesktopMain()

const app = mount(quickAddWindow ? QuickAddWindow : App, {
  target: document.getElementById('app')!,
})

export default app
