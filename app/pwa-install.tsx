"use client";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event { prompt:()=>Promise<void>; userChoice:Promise<{outcome:"accepted"|"dismissed"}> }

export default function PwaInstall(){
  const[prompt,setPrompt]=useState<InstallPromptEvent|null>(null),[ios,setIos]=useState(false),[visible,setVisible]=useState(false);
  useEffect(()=>{if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});const standalone=matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone;if(standalone||sessionStorage.getItem("reelrecall:pwa-dismissed"))return;const isIos=/iphone|ipad|ipod/i.test(navigator.userAgent);if(isIos){setIos(true);setVisible(true)}const handler=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent);setVisible(true)};addEventListener("beforeinstallprompt",handler);return()=>removeEventListener("beforeinstallprompt",handler)},[]);
  function close(){sessionStorage.setItem("reelrecall:pwa-dismissed","true");setVisible(false)}
  async function install(){if(!prompt)return;await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==="accepted")close()}
  if(!visible)return null;
  return <aside className="pwa-install" aria-label="Install ReelRecall"><div><strong>Install ReelRecall</strong><small>{ios?"In Safari, tap Share, then Add to Home Screen.":"Install ReelRecall, then share Facebook or Instagram reels directly to it."}</small></div>{prompt?<button className="pwa-install-action" onClick={install}>Install</button>:null}<button className="pwa-install-close" onClick={close} aria-label="Dismiss">×</button></aside>
}
