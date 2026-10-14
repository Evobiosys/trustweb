import { mount } from 'svelte'
import App from './app.svelte'
import './styles.css'
import { initDevFeature } from './dev_feature'

mount(App, { target: document.getElementById('app')! })
initDevFeature()
