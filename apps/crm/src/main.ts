import { mount } from 'svelte'
import App from './app.svelte'
import './styles.css'
import { initDevFeature } from './dev_feature'
import { applyTheme } from './prefs.svelte'

applyTheme()
mount(App, { target: document.getElementById('app')! })
initDevFeature()
