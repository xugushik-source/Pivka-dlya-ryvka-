(function(){
  function configured(){
    return Boolean(window.PIVKA_CONFIG && window.PIVKA_CONFIG.supabaseUrl && window.PIVKA_CONFIG.supabaseAnonKey && window.supabase);
  }
  function client(){
    if(!configured()) return null;
    if(!window.__pivkaSupabase){
      window.__pivkaSupabase=window.supabase.createClient(window.PIVKA_CONFIG.supabaseUrl,window.PIVKA_CONFIG.supabaseAnonKey);
    }
    return window.__pivkaSupabase;
  }
  async function listCatalog(){
    var c=client();
    if(!c) return {configured:false,categories:[],products:[]};
    var [cats,products]=await Promise.all([
      c.from('categories').select('*').eq('active',true).order('sort_order'),
      c.from('products').select('*').eq('active',true).order('sort_order')
    ]);
    if(cats.error) throw cats.error;
    if(products.error) throw products.error;
    return {configured:true,categories:cats.data||[],products:products.data||[]};
  }
  async function signIn(email,password){
    var c=client(); if(!c) throw new Error('Backend is not configured');
    var r=await c.auth.signInWithPassword({email:email,password:password});
    if(r.error) throw r.error; return r.data;
  }
  async function signOut(){var c=client(); if(c) await c.auth.signOut();}
  window.PivkaDB={configured:configured,client:client,listCatalog:listCatalog,signIn:signIn,signOut:signOut};
})();
