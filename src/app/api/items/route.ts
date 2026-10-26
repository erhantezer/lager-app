import { NextResponse } from 'next/server';
import { adminClient, authenticated } from '@/lib/supabase';
export const runtime='nodejs';
const unauthorized=()=>NextResponse.json({error:'Ingen tilgang'},{status:401});
export async function GET(req: Request) {
    if (!await authenticated(req)) return unauthorized();
  
    const db = adminClient();
  
    const { data, error } = await db
      .from('items')
      .select('*')
      .order('created_at', { ascending: true })
.order('id', { ascending: true });
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }
  
    // Samle bruker-ID-ene til dem som har lagt til produkter
    const userIds = [
      ...new Set(
        (data || [])
          .map(item => item.created_by)
          .filter((id): id is string => typeof id === 'string')
      )
    ];
  
    // Koble bruker-ID-er til e-postadresser
    const emails = new Map<string, string>();
  
    for (const userId of userIds) {
      const { data: userData, error: userError } =
        await db.auth.admin.getUserById(userId);
  
      if (!userError && userData.user?.email) {
        emails.set(userId, userData.user.email);
      }
    }
  
    const items = await Promise.all(
      (data || []).map(async item => {
        let image_url: string | null = null;
  
        if (item.image_path) {
          const { data: signed } = await db.storage
            .from('item-images')
            .createSignedUrl(item.image_path, 3600);
  
          image_url = signed?.signedUrl || null;
        }
  
        return {
          ...item,
          image_url,
          created_by_email:
            emails.get(item.created_by) || 'Ukjent bruker'
        };
      })
    );
  
    return NextResponse.json(items);
  }
export async function POST(req:Request){
 const user=await authenticated(req);if(!user)return unauthorized();
 const form=await req.formData();
 const name=String(form.get('name')||'').trim();const quantity=Number(form.get('quantity'));
 if(!name||name.length>180||!Number.isSafeInteger(quantity)||quantity<0)return NextResponse.json({error:'Ugyldig produktnavn eller antall'},{status:400});
 const db=adminClient();

 // Kontroller produktnavnet før eventuell bildeopplasting.
 const {data:existingItems,error:lookupError}=await db.from('items').select('id,name,quantity');
 if(lookupError)return NextResponse.json({error:lookupError.message},{status:500});
 const normalize=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('nb-NO');
 const existing=existingItems?.find(item=>normalize(item.name)===normalize(name));
 if(existing){
  return NextResponse.json({
   error:'Produktet finnes allerede på lageret.',
   code:'DUPLICATE_PRODUCT',
   existing_item:{id:existing.id,name:existing.name,quantity:existing.quantity},
   requested_quantity:quantity
  },{status:409});
 }

 let image_path:null|string=null;
 const file=form.get('image');
 if(file instanceof File&&file.size){
  if(file.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))return NextResponse.json({error:'Bildet må være JPG, PNG eller WebP og maks. 5 MB'},{status:400});
  const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
  image_path=`${user.id}/${crypto.randomUUID()}.${ext}`;
  const {error}=await db.storage.from('item-images').upload(image_path,file,{contentType:file.type});
  if(error)return NextResponse.json({error:error.message},{status:500});
 }
 const text=(key:string,max=500)=>String(form.get(key)||'').trim().slice(0,max);
 const {data,error}=await db.from('items').insert({name,quantity,category:text('category',100),location:text('location',100),description:text('description',2000),sku:text('sku',100)||null,image_path,created_by:user.id}).select().single();
 if(error){if(image_path)await db.storage.from('item-images').remove([image_path]);return NextResponse.json({error:error.message},{status:400});}
 return NextResponse.json(data,{status:201});
}
export async function DELETE(req:Request){
 const user=await authenticated(req);if(!user)return unauthorized();
 const {id}=await req.json();if(typeof id!=='string')return NextResponse.json({error:'Ugyldig produkt-ID'},{status:400});
 const db=adminClient();const {data:role}=await db.from('allowed_users').select('role').eq('user_id',user.id).single();
 if(role?.role!=='admin')return NextResponse.json({error:'Kun administratorer kan slette produkter'},{status:403});
 const {data:item}=await db.from('items').select('image_path').eq('id',id).single();
 const {error}=await db.from('items').delete().eq('id',id);if(error)return NextResponse.json({error:error.message},{status:500});
 if(item?.image_path)await db.storage.from('item-images').remove([item.image_path]);return NextResponse.json({ok:true});
}
