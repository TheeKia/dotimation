import { hydrate, mount } from 'svelte'
import Consumer from './Consumer.svelte'

const target = document.getElementById('app')!
if (target.hasChildNodes()) hydrate(Consumer, { target })
else mount(Consumer, { target })
