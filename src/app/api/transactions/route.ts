import {NextResponse} from 'next/server';
import {adminClient,authenticated} from '@/lib/supabase';
export async function GET(req:Request){if(!await authenticated(req))return NextResponse.json({error:'Ingen tilgang'},{status:401});
 const {data,error}=await adminClient().from('stock_movements').select('*,items(name)').order('created_at',{ascending:false}).limit(100);
 return error?NextResponse.json({error:error.message},{status:500}):NextResponse.json(data);
}
export async function POST(req:Request){const user=await authenticated(req);if(!user)return NextResponse.json({error:'Ingen tilgang'},{status:401});
 const {item_id,delta,note}=await req.json();if(typeof item_id!=='string'||!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>100000)return NextResponse.json({error:'Ugyldig lagerbevegelse'},{status:400});
 const {data,error}=await adminClient().rpc('change_stock',{p_item_id:item_id,p_delta:delta,p_note:String(note||'').slice(0,500),p_user_id:user.id});
 return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({quantity:data});}
