"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./GeneralEcologicalSwmsForm.module.css";
import SignaturePad from "./SignaturePad";
import {
  GENERAL_ECOLOGICAL_SWMS_TREE, GENERAL_ECOLOGICAL_SWMS_MANIFEST,
  GENERAL_ECOLOGICAL_SWMS_LOGO_DATA_URL, GENERAL_ECOLOGICAL_SWMS_HIGH_RISK,
  createBlankGeneralEcologicalSwmsDetails, normaliseGeneralEcologicalSwmsDetails,
  buildGeneralEcologicalSwmsHtml, isGeneralEcologicalSwmsDate,
} from "../lib/generalEcologicalSwmsTemplate";

const styleObject = value => Object.fromEntries(String(value || "").split(";").filter(Boolean).map(part => {
  const index = part.indexOf(":");
  return [part.slice(0,index).trim().replace(/-([a-z])/g,(_,c) => c.toUpperCase()), part.slice(index+1).trim()];
}));
const attrsToProps = attrs => Object.fromEntries(Object.entries(attrs).filter(([k]) => !k.startsWith("on")).map(([k,v]) => [
  ({class:"className",colspan:"colSpan",rowspan:"rowSpan"})[k] || k,
  k === "style" ? styleObject(v) : Array.isArray(v) ? v.join(" ") : v,
]));

const DRAFT_TTL_MS = 8 * 60 * 60 * 1000;
const draftKey = userId => userId ? `ecology-consulting:general-swms:v2:${encodeURIComponent(userId)}` : null;

export default function GeneralEcologicalSwmsForm({
  authFetch, defaultName = "", userId = "", initialDetails, controlledDates = {}, onBack,
  onSubmitted, onToast,
  onSubmitDetails, onOpenControlledSource,
}) {
  const [form,setForm] = useState(() => initialDetails
    ? normaliseGeneralEcologicalSwmsDetails(initialDetails).details
    : createBlankGeneralEcologicalSwmsDetails(defaultName));
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [submitted,setSubmitted] = useState(false);
  const [loadedUser,setLoadedUser] = useState(null);
  const [draftEpoch,setDraftEpoch] = useState(0);
  const createdAt = useRef(Date.now());
  const submissionLock = useRef(false);
  const pendingPayload = useRef(null);
  const activeUser = useRef(userId);
  useEffect(() => {
    activeUser.current=userId;
    const key=draftKey(userId);
    let restored=initialDetails ? normaliseGeneralEcologicalSwmsDetails(initialDetails).details : createBlankGeneralEcologicalSwmsDetails(defaultName);
    createdAt.current=Date.now();
    if(key && !initialDetails) {
      try {
        const saved=JSON.parse(window.sessionStorage.getItem(key) || 'null');
        if(saved && Number.isFinite(saved.createdAt) && saved.createdAt<=Date.now() && Date.now()-saved.createdAt<DRAFT_TTL_MS && saved.details?.templateVersion===2 && saved.details?.documentCode==='EC-SWMS00') {
          restored=normaliseGeneralEcologicalSwmsDetails(saved.details).details;
          createdAt.current=saved.createdAt;
        } else window.sessionStorage.removeItem(key);
      } catch { try { window.sessionStorage.removeItem(key); } catch {} }
    }
    pendingPayload.current=null; submissionLock.current=false;
    setForm(restored); setSubmitted(false); setBusy(false); setError(''); setMessage(''); setLoadedUser(userId); setDraftEpoch(n=>n+1);
  }, [userId]); // One draft identity per authenticated user, never shared localStorage.
  useEffect(() => {
    const key=draftKey(userId);
    if(!key || loadedUser!==userId || submitted) return;
    try {
      if(Date.now()-createdAt.current>=DRAFT_TTL_MS) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key,JSON.stringify({createdAt:createdAt.current,details:form}));
    } catch {}
  }, [form,userId,loadedUser,submitted]);
  useEffect(() => {
    const key=draftKey(userId); if(!key || loadedUser!==userId) return;
    const timer=window.setTimeout(()=>{try { window.sessionStorage.removeItem(key); } catch {}},Math.max(0,DRAFT_TTL_MS-(Date.now()-createdAt.current)));
    return ()=>window.clearTimeout(timer);
  }, [userId,loadedUser]);
  const openSource = async code => {
    if(onOpenControlledSource) return onOpenControlledSource(code);
    if(!authFetch) return;
    try {
      const response=await authFetch('GET',`/api/governance-source?key=${encodeURIComponent(code)}`);
      if(!response.ok) throw new Error('The controlled SWMS could not be opened.');
      const url=URL.createObjectURL(await response.blob());
      window.open(url,'_blank','noopener,noreferrer');
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
    } catch(e) { setError(e.message || 'The controlled SWMS could not be opened.'); }
  };
  const checked = useMemo(() => normaliseGeneralEcologicalSwmsDetails(form,{controlledDates}),[form,controlledDates]);
  const edit = change => {
    if(submissionLock.current || submitted) return;
    pendingPayload.current=null;
    setForm(current=>({...change(current),signedAt:''}));
  };
  const set = (key,value) => edit(current => ({...current,[key]:value}));
  const setTeam = (index,key,value) => edit(current => ({...current,team:current.team.map((member,i) => i === index ? {...member,[key]:value}:member)}));
  const captureSignature = (index,value) => {
    if(!value) { setTeam(index,'signature',''); return; }
    // Existing SignaturePad can emit a transparent PNG after a tap without a
    // stroke. Require visible dark pixels instead of treating that as a signature.
    const image=new Image();
    const signatureUser=userId;
    image.onload=()=>{
      if(activeUser.current!==signatureUser) return;
      const canvas=document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let ink=0;
      for(let i=0;i<pixels.length;i+=4) if(pixels[i+3]>40 && pixels[i]+pixels[i+1]+pixels[i+2]<600) ink++;
      setTeam(index,'signature',ink>=12 ? value:'');
      if(ink<12) setError(`Draw a visible signature in crew row ${index+1}; an empty tap is not a signature.`);
    };
    image.onerror=()=>setTeam(index,'signature',''); image.src=value;
  };
  const setFlag = (group,id,value) => edit(current => ({...current,[group]:{...current[group],[id]:value}}));
  const setRisk = (id,answer,isChecked) => edit(current => ({
    ...current, highRisk:{...current.highRisk,[id]:isChecked ? answer === "yes":false},
    highRiskAssessed:{...current.highRiskAssessed,[id]:isChecked},
  }));
  const field = (key,path) => {
    if(key === "documentReleaseDate" || key === "nextReview") return <span key={path} aria-label={`${key}: controlled by administration`}>
      {isGeneralEcologicalSwmsDate(controlledDates[key]) ? controlledDates[key]:"\u00a0"}
    </span>;
    if(key === "workplace") return <div className="gswms__identity" key={path}>
      {[['project','Project','text'],['site','Site / work area','text'],['jobNumber','Job number','text'],['date','Work date','date']].map(([id,label,type]) => <label key={id}>{label}<input type={type} value={form[id]} onChange={e=>set(id,e.target.value)} maxLength={id==='site'?1000:id==='project'?240:id==='jobNumber'?120:10} /></label>)}
    </div>;
    const parts=key.split('.');
    if(parts[0] === 'team') {
      const i=Number(parts[1]), prop=parts[2], member=form.team[i];
      if(prop === 'signature' && submitted) return member.signature ? <img key={path} src={member.signature} alt={`Crew row ${i+1} recorded signature`} style={{maxWidth:'100%',height:80,objectFit:'contain'}} /> : <span key={path} />;
      if(prop === 'signature') return <SignaturePad key={`${path}.${draftEpoch}`} label={`Crew row ${i+1} signature`} value={member.signature} onChange={value=>captureSignature(i,value)} />;
      return <input key={path} aria-label={`Crew row ${i+1} ${prop}`} type={prop==='date'?'date':'text'} value={member[prop]} onChange={e=>setTeam(i,prop,e.target.value)} maxLength={prop==='date'?10:120} />;
    }
    return <input key={path} aria-label={key==='client'?'Client / Principal Contractor':'Field work duration'} value={form[key]} onChange={e=>set(key,e.target.value)} maxLength={240} />;
  };
  function render(node,path='root') {
    if(typeof node === 'string') return node;
    if(node.attrs['data-field']) return field(node.attrs['data-field'],path);
    if(node.attrs['data-check']) {
      const [group,id]=node.attrs['data-check'].split('.');
      const sourceLabel=GENERAL_ECOLOGICAL_SWMS_MANIFEST.checkboxes.find(x=>x.group===group && x.id===id)?.label || id;
      return <input key={path} type="checkbox" aria-label={sourceLabel} checked={form[group][id]===true} onChange={e=>setFlag(group,id,e.target.checked)} />;
    }
    if(node.attrs['data-risk']) {
      const [id,answer]=node.attrs['data-risk'].split('.');
      const category=GENERAL_ECOLOGICAL_SWMS_HIGH_RISK.find(x=>x.id===id);
      return <input key={path} type="checkbox" aria-label={`${category.label}: ${answer}`} checked={form.highRiskAssessed[id] && (answer==='yes'?form.highRisk[id]:!form.highRisk[id])} onChange={e=>setRisk(id,answer,e.target.checked)} />;
    }
    const props={...attrsToProps(node.attrs),key:path};
    if(node.tag === 'img') { props.src=GENERAL_ECOLOGICAL_SWMS_LOGO_DATA_URL; return React.createElement('img',props); }
    const children=node.children.map((child,i)=>render(child,`${path}.${i}`));
    // Source table 10 is the exact five-column 19-category register. Add source
    // opening actions only in its existing EC SWMS cell, never editable controls text.
    if(node.tag==='tr' && node.children.some(child=>typeof child==='object' && child.tag==='td' && child.children.some(x=>typeof x==='string' && /^\d{2}$/.test(x)))) {
      const tds=node.children.filter(x=>typeof x==='object' && x.tag==='td');
      if(tds.length===5) {
        const ident='hrcw'+tds[0].children.find(x=>typeof x==='string');
        const category=GENERAL_ECOLOGICAL_SWMS_HIGH_RISK.find(x=>x.id===ident);
        if(category && form.highRiskAssessed[ident] && form.highRisk[ident]) {
          const sourceIndex=node.children.indexOf(tds[3]);
          const sourceNode=tds[3];
          children[sourceIndex]=React.createElement('td',{...attrsToProps(sourceNode.attrs),key:`${path}.source`},
            sourceNode.children.map((child,i)=>render(child,`${path}.source.${i}`)),
            <div className="gswms__source-links" key="links">{category.documentCodes.length
              ? category.documentCodes.map(code=><button type="button" key={code} disabled={!onOpenControlledSource && !authFetch} onClick={()=>openSource(code)}>Open controlled {code}</button>)
              : <span>Stop: follow the source instruction for categories without an EC SWMS.</span>}</div>);
        }
      }
    }
    return React.createElement(node.tag,props,...children);
  }
  const complete = () => {
    const result=normaliseGeneralEcologicalSwmsDetails(form,{controlledDates});
    if(result.errors.length) { setError(result.errors.join(' ')); return null; }
    setError(''); return result.details;
  };
  const printLandscape = async () => {
    const details=complete(); if(!details) return;
    const popup=window.open('', '_blank');
    if(!popup) { setError('Allow pop-ups to open the isolated landscape print document.'); return; }
    popup.opener=null;
    popup.document.open(); popup.document.write(buildGeneralEcologicalSwmsHtml(details,{controlledDates})); popup.document.close();
    await Promise.all(Array.from(popup.document.images).map(img => img.complete ? Promise.resolve() : new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;})));
    if(popup.document.fonts?.ready) await popup.document.fonts.ready;
    popup.focus(); popup.print();
  };
  const downloadHtml = () => {
    const details=complete(); if(!details) return;
    const url=URL.createObjectURL(new Blob([buildGeneralEcologicalSwmsHtml(details,{controlledDates})],{type:'text/html;charset=utf-8'}));
    const link=document.createElement('a'); link.href=url; link.download='EC-SWMS00-completed.html'; link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  const submit = async () => {
    const details=complete(); if(!details || (!onSubmitDetails && !authFetch) || busy || submitted || submissionLock.current) return;
    submissionLock.current=true; setBusy(true);
    const candidate={...details,signedAt:''};
    const unchanged=pendingPayload.current && JSON.stringify({...pendingPayload.current,signedAt:''})===JSON.stringify(candidate);
    const payload=unchanged ? pendingPayload.current : {...details,signedAt:details.signedAt || new Date().toISOString()};
    const submittingUser=userId;
    pendingPayload.current=payload;
    // Persist the timestamp before the network request so a lost response or
    // browser refresh retries the exact same signed record, not a duplicate.
    setForm(payload);
    try { const key=draftKey(userId); if(key) window.sessionStorage.setItem(key,JSON.stringify({createdAt:createdAt.current,details:payload})); } catch {}
    try {
      let data;
      if(onSubmitDetails) data=await onSubmitDetails(payload);
      else {
        const response=await authFetch('POST','/api/whs-forms',{
          form_type:'ecological_field_swms',title:`General ecological survey work — ${payload.project}`,
          site:payload.site,form_date:payload.date,details:payload,
        });
        data=await response.json();
        if(!response.ok) throw new Error(data.error || 'The SWMS could not be submitted.');
      }
      if(activeUser.current!==submittingUser) return;
      setForm(payload); setSubmitted(true);
      try { const key=draftKey(userId); if(key) window.sessionStorage.removeItem(key); } catch {}
      const notice=data?.duplicate ? 'This SWMS was already submitted. The existing record has been retained. You can still print or export this report.' : 'SWMS submitted. Your completed report remains here for printing or export.';
      setMessage(notice); onToast?.(notice);
      try { await onSubmitted?.(); } catch { setMessage(notice+' History refresh failed; please refresh history separately.'); }
    } catch(e) { if(activeUser.current===submittingUser) setError(e?.message || 'Submission failed.'); }
    finally { if(activeUser.current===submittingUser) { submissionLock.current=false; setBusy(false); } }
  };
  return <section className={`${styles.root} gswms`}>
    {/* @page must not affect the app's other forms; it is emitted only by the isolated exporter. */}
    <div className="gswms__toolbar"><button type="button" onClick={onBack}>Back to forms</button><button type="button" onClick={printLandscape}>Print / Save landscape PDF</button><button type="button" onClick={downloadHtml}>Download completed HTML</button><button type="button" disabled={(!onSubmitDetails && !authFetch) || busy || submitted} onClick={submit}>{busy?'Submitting…':submitted?'Submitted':'Submit completed SWMS'}</button></div>
    <p className="gswms__notice">Only blank cells and ticks can be changed. Drawn signatures are required for every listed worker, including a Field Lead. Select Yes or No in all 19 applicability rows. A tick is not authorisation to undertake high risk work. For PDF: choose Save as PDF, A4, Landscape, background graphics on, and browser headers/footers off.</p>
    {error ? <p className="gswms__error" role="alert">{error}</p>:null}
    {message ? <p className="gswms__notice" role="status">{message}</p>:null}
    <div className="gswms__viewport"><fieldset className={styles.sheetFieldset} disabled={submitted || busy} style={busy?{pointerEvents:'none'}:undefined}>{render(GENERAL_ECOLOGICAL_SWMS_TREE)}</fieldset></div>
    {checked.warnings.length ? <div className="gswms__notice">{checked.warnings.map(w=><p key={w}>{w}</p>)}</div>:null}
  </section>;
}
