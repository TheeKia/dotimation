import { render } from 'svelte/server'
import Consumer from './Consumer.svelte'

export const html = render(Consumer).body
