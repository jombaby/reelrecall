import {NextRequest,NextResponse} from "next/server";

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  try{
    const form=await request.formData(),value=form.get("file");
    if(!(value instanceof File))return NextResponse.json({error:"Video file is required"},{status:400});
    if(value.size>3000000)return NextResponse.json({error:"File is too large for direct narration analysis"},{status:413});
    const upstream=new FormData();upstream.append("file",value,value.name||"video.mp4");upstream.append("model","gpt-transcribe");
    const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:upstream,signal:AbortSignal.timeout(45000)});
    if(!response.ok){const detail=await response.text();console.error("video-transcript OpenAI error",response.status,detail.slice(0,500));return NextResponse.json({text:""})}
    const data=await response.json() as {text?:string};return NextResponse.json({text:(data.text??"").trim().slice(0,16000)});
  }catch(error){console.error(error);return NextResponse.json({text:""})}
}
