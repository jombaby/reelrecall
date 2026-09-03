"use client";
import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event { prompt:()=>Promise<void>; userChoice:Promise<{outcome:"accepted"|"dismissed"}> }
type Platform = "ios"|"android"|"desktop";

export default function PwaInstall(){
  const[prompt,setPrompt]=useState<InstallPromptEvent|null>(null),[platform,setPlatform]=useState<Platform>("desktop"),[visible,setVisible]=useState(false),[manualHelp,setManualHelp]=useState(false);
  useEffect(()=>{if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});const standalone=matchMedia("(display-mode: standalone)").matches||(navigator as Navigator&{standalone?:boolean}).standalone;if(standalone)return;const agent=navigator.userAgent,isIos=/iphone|ipad|ipod/i.test(agent),isAndroid=/android/i.test(agent);setPlatform(isIos?"ios":isAndroid?"android":"desktop");if(isIos||isAndroid)setVisible(true);const handler=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent);setManualHelp(false);setVisible(true)},installed=()=>setVisible(false);addEventListener("beforeinstallprompt",handler);addEventListener("appinstalled",installed);return()=>{removeEventListener("beforeinstallprompt",handler);removeEventListener("appinstalled",installed)}},[]);
  function close(){setVisible(false)}
  async function install(){if(!prompt){setManualHelp(true);return}await prompt.prompt();const choice=await prompt.userChoice;setPrompt(null);if(choice.outcome==="accepted")close();else setManualHelp(true)}
  if(!visible)return null;
  const instructions=platform==="ios"?"In Chrome, tap Share, then choose Add to Home Screen.":platform==="android"?"Open Chrome’s ⋮ menu, then tap Install app or Add to Home screen.":"Use Chrome’s install icon or open the ⋮ menu and choose Install ReelRecall.";
  return <aside className="pwa-install" aria-label="Install ReelRecall"><div><strong>Install ReelRecall</strong><small>{manualHelp?instructions:"Add ReelRecall to your Home Screen for faster access and direct sharing."}</small></div><button className="pwa-install-action" onClick={()=>manualHelp?close():void install()}>{manualHelp?"Got it":"Install app"}</button><button className="pwa-install-close" onClick={close} aria-label="Dismiss">×</button></aside>
}
