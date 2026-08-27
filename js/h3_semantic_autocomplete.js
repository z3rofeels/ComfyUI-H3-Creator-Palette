/**
 * One focus-safe autocomplete controller for Creator Palette semantic calls.
 *
 * @Cast and $Scene provide domain-specific lookup/commit adapters, but popup
 * lifecycle, keyboard navigation, favorites, recents, positioning and focus
 * behavior live here.  The popup never receives focus: every pointer action is
 * handled from mousedown with preventDefault(), while typing remains in the
 * Visual Prompt Editor.
 */
import { getCaretCoords } from "./editor/autocomplete.js";
import { copyPromptPaletteThemeScope } from "./prompt_palette_shared.js";
import {
  SEMANTIC_CALL_ACTIONS,
  actionDirection,
  handleSemanticCallKey,
  captureSemanticEditorSelection,
  semanticNavigationKey,
} from "./h3_semantic_call_contract.js";

const FAVORITES_KEY="z3.minimaxCreator.semanticAutocomplete.favorites.v1";
const RECENTS_KEY="z3.minimaxCreator.semanticAutocomplete.recents.v1";

function readMap(key){try{const value=JSON.parse(localStorage.getItem(key)||"{}");return value&&typeof value==="object"&&!Array.isArray(value)?value:{};}catch{return {};}}
function writeMap(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* local preferences are optional */}}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));}
function initials(value){return String(value||"?").split(/[\s_]+/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()||"").join("")||"?";}
function cleanKey(value){return String(value||"").trim();}

function favoriteKeys(domain){const map=readMap(FAVORITES_KEY),rows=map[domain];return new Set(Array.isArray(rows)?rows.map(cleanKey).filter(Boolean):[]);}
function toggleFavorite(domain,key){const clean=cleanKey(key);if(!clean)return false;const map=readMap(FAVORITES_KEY),rows=new Set(Array.isArray(map[domain])?map[domain].map(cleanKey).filter(Boolean):[]);if(rows.has(clean))rows.delete(clean);else rows.add(clean);map[domain]=[...rows].slice(0,100);writeMap(FAVORITES_KEY,map);return rows.has(clean);}
function recentKeys(domain){const map=readMap(RECENTS_KEY),rows=map[domain];return Array.isArray(rows)?rows.map((row)=>typeof row==="string"?{key:row,usedAt:0}:row).filter((row)=>cleanKey(row?.key)):[];}
function noteRecent(domain,key){const clean=cleanKey(key);if(!clean)return;const map=readMap(RECENTS_KEY),rows=Array.isArray(map[domain])?map[domain]:[];map[domain]=[{key:clean,usedAt:Date.now()},...rows.filter((row)=>cleanKey(typeof row==="string"?row:row?.key)!==clean)].slice(0,30);writeMap(RECENTS_KEY,map);}

function orderedItems(domain,items,query,maxItems=16){
  const favorites=favoriteKeys(domain),recents=recentKeys(domain),recentRank=new Map(recents.map((row,index)=>[cleanKey(row.key),index]));
  const q=String(query||"").trim();
  const rows=(Array.isArray(items)?items:[]).map((raw,index)=>{
    const item={...raw};item.key=cleanKey(item.key||`${domain}:${item.value||item.label||index}`);item.favorite=favorites.has(item.key);item.recentRank=recentRank.has(item.key)?recentRank.get(item.key):-1;return item;
  });
  rows.sort((a,b)=>{
    const exact=Number(!!b.exact)-Number(!!a.exact);if(exact)return exact;
    const fav=Number(!!b.favorite)-Number(!!a.favorite);if(fav)return fav;
    const ar=a.recentRank,br=b.recentRank;if(ar>=0||br>=0){if(ar<0)return 1;if(br<0)return-1;if(ar!==br)return ar-br;}
    const score=Number(b.score||0)-Number(a.score||0);if(score)return score;
    return String(a.label||"").localeCompare(String(b.label||""));
  });
  const limit=Math.max(1,Number(maxItems)||16),visible=rows.slice(0,limit);
  // Domain adapters can mark a legacy/critical action (for example Create Cast)
  // as always visible without giving it an artificial search rank.
  for(const item of rows){if(!item.alwaysVisible||visible.some((row)=>row.key===item.key))continue;if(visible.length>=limit)visible.pop();visible.push(item);}
  for(const item of visible){item.section=item.exact?"Exact match":item.favorite?"Favorites":item.recentRank>=0?"Recent":q?"Matches":"Suggestions";}
  return visible;
}

export function createSemanticAutocomplete({
  domain,prefix,title,subtitle="",body,editor,getContext,getItems,onCommit,
  emptyText="No matches",loadingText="Loading…",maxItems=16,actionLabel=null,
}={}){
  let menu=null,state=null,serial=0,composing=false,navQueued=false;
  const ensureMenu=()=>{
    if(menu)return menu;
    menu=document.createElement("div");menu.className="z3h3-semantic-menu";menu.hidden=true;menu.dataset.promptPaletteGlobal="true";menu.dataset.semanticDomain=domain||"semantic";document.body.append(menu);
    menu.addEventListener("mousedown",(event)=>{
      if(!state)return;
      const favorite=event.target.closest?.("[data-z3-semantic-favorite]");
      const action=event.target.closest?.("[data-z3-semantic-action]");
      const row=event.target.closest?.("[data-z3-semantic-index]");
      if(!favorite&&!action&&!row)return;
      // Critical: never move focus from the editor into the popup.
      event.preventDefault();event.stopPropagation();
      const target=favorite||action||row,index=Number(target.dataset.z3SemanticIndex);
      if(!Number.isInteger(index)||!state.items[index])return;
      if(favorite){const item=state.items[index];if(item.favoriteable===false)return;toggleFavorite(domain,item.key);state.items=orderedItems(domain,state.rawItems,state.query,maxItems);state.index=Math.min(state.index,Math.max(0,state.items.length-1));render();return;}
      commit(index,action?.dataset.z3SemanticAction||"default");
    });
    return menu;
  };
  const close=()=>{serial+=1;if(menu)menu.hidden=true;state=null;};
  const position=()=>{if(!state)return;const popup=ensureMenu(),coords=getCaretCoords(state.editor,state.end),prefWidth=Math.max(300,Math.min(680,Number(state.body?.uiPrefs?.autocomplete_width)||420)),prefHeight=Math.max(180,Math.min(620,Number(state.body?.uiPrefs?.autocomplete_max_height)||320));popup.style.width=`min(${prefWidth}px, calc(100vw - 16px))`;popup.style.maxHeight=`min(${prefHeight}px, calc(100vh - 24px))`;const width=Math.min(prefWidth,Math.max(300,popup.getBoundingClientRect?.().width||prefWidth));popup.style.left=`${Math.max(8,Math.min(coords.left,window.innerWidth-width-8))}px`;popup.style.top=`${Math.max(8,Math.min(coords.top+coords.lineHeight+5,window.innerHeight-prefHeight-8))}px`;};
  const renderVisual=(item)=>{
    const visual=document.createElement("div");visual.className="z3h3-semantic-visual";if(item.color)visual.style.setProperty("--semantic-tone",String(item.color));
    if(item.image){visual.style.backgroundImage=`url("${String(item.image).replaceAll('"','%22')}")`;visual.classList.add("has-image");}
    else visual.textContent=String(item.icon||initials(item.label));return visual;
  };
  const render=()=>{
    if(!state)return close();const popup=ensureMenu(),scope=editor?.closest?.(".z3h3, .wg-root, .wg-node, .pp-node, .ppwc-surface");if(scope)copyPromptPaletteThemeScope(scope,popup);popup.replaceChildren();
    const head=document.createElement("div");head.className="z3h3-semantic-head";head.innerHTML=`<b>${escapeHtml(title||`${prefix||""} Autocomplete`)}</b><span>${escapeHtml(state.loading?loadingText:subtitle)}</span>`;popup.append(head);
    if(state.error){const note=document.createElement("div");note.className="z3h3-semantic-empty";note.textContent=state.error;popup.append(note);}
    else if(state.loading&&!state.items.length){const note=document.createElement("div");note.className="z3h3-semantic-empty";note.textContent=loadingText;popup.append(note);}
    else if(!state.items.length){const note=document.createElement("div");note.className="z3h3-semantic-empty";note.textContent=emptyText;popup.append(note);}
    else{
      let section="";
      state.items.forEach((item,index)=>{
        if(item.section!==section){section=item.section;const heading=document.createElement("div");heading.className="z3h3-semantic-section";heading.textContent=section;popup.append(heading);}
        const row=document.createElement("div");row.className=`z3h3-semantic-item${index===state.index?" active":""}`;row.dataset.z3SemanticIndex=String(index);if(item.color)row.style.setProperty("--semantic-tone",String(item.color));
        const copy=document.createElement("div");copy.className="z3h3-semantic-copy";copy.innerHTML=`<strong>${escapeHtml(item.label||item.value||"")}</strong>${item.meta?`<small>${escapeHtml(item.meta)}</small>`:""}${item.description?`<span>${escapeHtml(item.description)}</span>`:""}`;
        const tools=document.createElement("div");tools.className="z3h3-semantic-actions";
        if(item.favoriteable!==false){const star=document.createElement("button");star.type="button";star.tabIndex=-1;star.dataset.z3SemanticFavorite="1";star.dataset.z3SemanticIndex=String(index);star.textContent=item.favorite?"★":"☆";star.title=item.favorite?"Remove from autocomplete Favorites":"Add to autocomplete Favorites";tools.append(star);}
        for(const action of SEMANTIC_CALL_ACTIONS){const button=document.createElement("button");button.type="button";button.tabIndex=-1;button.dataset.z3SemanticAction=action.id;button.dataset.z3SemanticIndex=String(index);button.textContent=typeof actionLabel==="function"?actionLabel(item,action):action.label;if(action.direction===state.direction&&action.direction!==0)button.classList.add("active");tools.append(button);}
        row.append(renderVisual(item),copy,tools);popup.append(row);
      });
    }
    const foot=document.createElement("div");foot.className="z3h3-semantic-foot";foot.textContent=`↑↓ choose · Enter/Tab insert · Esc dismiss · typing stays in editor${state.direction>0?" · + variation":state.direction<0?" · − variation":""}`;popup.append(foot);popup.hidden=false;position();
  };
  const update=async()=>{
    if(!body||!editor)return close();const selection=captureSemanticEditorSelection(editor);if(!selection)return close();const ctx=getContext?.(selection.value,selection.start);if(!ctx)return close();
    const request=++serial,previousIndex=state?.editor===editor&&state?.query===ctx.query&&state?.direction===ctx.direction?Number(state.index)||0:0;
    state={body,editor,...ctx,query:String(ctx.query||""),rawItems:[],items:[],index:previousIndex,loading:true,error:"",request};render();
    try{
      const rawItems=await Promise.resolve(getItems?.(body,ctx.query,ctx)||[]);if(!state||state.request!==request||serial!==request)return;
      const live=captureSemanticEditorSelection(editor),liveCtx=live?getContext?.(live.value,live.start):null;
      // Never apply results to a newer keystroke, IME commit, click or caret move.
      if(!live||!liveCtx||live.value!==selection.value||live.start!==selection.start||live.end!==selection.end||liveCtx.start!==ctx.start||liveCtx.end!==ctx.end||String(liveCtx.query||"")!==String(ctx.query||"")||Number(liveCtx.direction||0)!==Number(ctx.direction||0))return;
      state.rawItems=Array.isArray(rawItems)?rawItems:[];state.items=orderedItems(domain,state.rawItems,state.query,maxItems);state.index=Math.min(previousIndex,Math.max(0,state.items.length-1));state.loading=false;render();
    }catch(error){if(!state||state.request!==request)return;state.loading=false;state.error=error?.message||String(error);render();}
  };
  const commit=async(index=state?.index??0,mode="default")=>{
    if(!state||!state.items[index])return;const snapshot=state,item=snapshot.items[index],direction=actionDirection(mode,snapshot.direction);noteRecent(domain,item.key);close();await onCommit?.({snapshot,item,direction,mode});
  };
  const queueUpdate=()=>{if(navQueued||composing)return;navQueued=true;const raf=globalThis.requestAnimationFrame||((fn)=>setTimeout(fn,0));raf(()=>{navQueued=false;if(!composing)update();});};
  const onInput=()=>{if(!composing)update();},onClick=()=>{if(!composing)update();};
  const onCompositionStart=()=>{composing=true;close();},onCompositionEnd=()=>{composing=false;queueUpdate();};
  const onKey=(event)=>{if(!composing&&state&&state.editor===editor&&!menu?.hidden&&handleSemanticCallKey(event,state,{render,commit,close}))return;if(!composing&&semanticNavigationKey(event.key))queueUpdate();};
  const onDocumentMouseDown=(event)=>{if(!state)return;if(menu?.contains(event.target)||event.target===editor||editor?.contains?.(event.target))return;close();};
  editor?.addEventListener("input",onInput);editor?.addEventListener("click",onClick);editor?.addEventListener("keydown",onKey,true);editor?.addEventListener("compositionstart",onCompositionStart);editor?.addEventListener("compositionend",onCompositionEnd);document.addEventListener("mousedown",onDocumentMouseDown);
  return ()=>{editor?.removeEventListener("input",onInput);editor?.removeEventListener("click",onClick);editor?.removeEventListener("keydown",onKey,true);editor?.removeEventListener("compositionstart",onCompositionStart);editor?.removeEventListener("compositionend",onCompositionEnd);document.removeEventListener("mousedown",onDocumentMouseDown);close();menu?.remove();menu=null;};
}
