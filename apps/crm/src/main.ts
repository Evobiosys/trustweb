import { mount } from 'svelte'
import App from './app.svelte'
import './styles.css'

mount(App, { target: document.getElementById('app')! })
