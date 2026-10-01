const products=require('../../ref-products-dom.json');
const PUBLIC_ORIGIN='https://menu-qrcode-lt1q.vercel.app';
const SUPABASE_URL='https://gelezvudpcsnhqgjaqkl.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_w24dlBQIlqYyQwY-6bJPmw_KNa-FCRK';

function esc(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function getProduct(id){
  if(!Number.isInteger(id)||id<=0)return null;
  try{
    const response=await fetch(`${SUPABASE_URL}/rest/v1/dishes?id=eq.${id}&select=id,name,weight,description,price,image_url,detail_image_url&limit=1`,{
      headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Accept:'application/json'}
    });
    if(!response.ok)throw new Error('Supabase product '+response.status);
    const rows=await response.json();
    if(rows[0])return {
      name:rows[0].name,
      weight:rows[0].weight,
      desc:rows[0].description,
      price:Number(rows[0].price)||0,
      img:rows[0].image_url,
      detailImg:rows[0].detail_image_url
    };
  }catch(error){
    console.warn(error);
  }
  return products[id-1]||null;
}

module.exports=async function handler(req,res){
  const id=Number(req.query.id);
  const item=await getProduct(id);
  if(!item){res.statusCode=404;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>Товар не найден — Sushi Crazy</title><p>Товар не найден.</p>');return;}
  const origin=PUBLIC_ORIGIN;
  const target=origin+'/?product='+id;
  const image=item.detailImg||item.img||'/icons/app-512.png';
  const imageUrl=image.startsWith('http')?image:origin+image;
  const title=item.name+' — Sushi Crazy';
  const description=[item.weight,item.desc,item.price?item.price.toLocaleString('ru-RU')+' ₸':''].filter(Boolean).join(' · ');
  const html=`<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Sushi Crazy">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta property="og:url" content="${esc(origin+'/product/'+id)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(imageUrl)}">
<link rel="canonical" href="${esc(origin+'/product/'+id)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)})</script>
</head><body><p>Открываем «${esc(item.name)}»…</p><p><a href="${esc(target)}">Перейти к товару</a></p></body></html>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
  res.statusCode=200;
  res.end(html);
};
