import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ScrollView, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import QRCode from 'react-native-qrcode-svg';

// Snack-safe: Don't import expo-camera at top level
let CameraView = null;
let useCameraPermissions = null;
try {
  if (Platform.OS !== 'web') {
    const Cam = require('expo-camera');
    CameraView = Cam.CameraView;
    useCameraPermissions = Cam.useCameraPermissions;
  }
} catch (e) {}

const KEYS = { USER: '@qrc_user', GEN: '@qrc_gen', SCAN: '@qrc_scan' };
const EXPIRY_MS = 24*60*60*1000;
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,9);

function Calendar({ selectedStart, selectedEnd, markers, onSelectDate, month, setMonth }){
  const y=month.getFullYear(), m=month.getMonth();
  const first=new Date(y,m,1).getDay();
  const dim=new Date(y,m+1,0).getDate();
  const days=[]; for(let i=0;i<first;i++) days.push(null); for(let d=1; d<=dim; d++) days.push(new Date(y,m,d));
  const isSel=(dt)=>{ if(!dt||!selectedStart) return false; const ds=dt.toISOString().slice(0,10); if(!selectedEnd) return ds===selectedStart; return ds>=selectedStart && ds<=selectedEnd; };
  return (
    <View style={styles.calWrap}>
      <View style={styles.calHeader}>
        <TouchableOpacity onPress={()=> setMonth(new Date(y,m-1,1))}><Text style={styles.calNav}>‹</Text></TouchableOpacity>
        <Text style={styles.calTitle}>{month.toLocaleString('default',{month:'long'})} {y}</Text>
        <TouchableOpacity onPress={()=> setMonth(new Date(y,m+1,1))}><Text style={styles.calNav}>›</Text></TouchableOpacity>
      </View>
      <View style={styles.calGrid}>
        {['S','M','T','W','T','F','S'].map((d,i)=><Text key={i} style={styles.calDow}>{d}</Text>)}
        {days.map((date,i)=>{ if(!date) return <View key={i} style={styles.calCell}/>; const ds=date.toISOString().slice(0,10); const has=markers.includes(ds); const sel=isSel(date); return (<TouchableOpacity key={i} style={[styles.calCell, sel&&styles.calSel]} onPress={()=> onSelectDate(ds)}><Text style={[styles.calDay, sel&&styles.calDaySel]}>{date.getDate()}</Text>{has&&<View style={styles.dot}/>}</TouchableOpacity>); })}
      </View>
    </View>
  );
}

export default function App(){
  const [user,setUser]=useState(null); const [nameInput,setNameInput]=useState(''); const [phoneInput,setPhoneInput]=useState('');
  const [tab,setTab]=useState('generate'); const [genRecords,setGenRecords]=useState([]); const [scanRecords,setScanRecords]=useState([]);
  const [custName,setCustName]=useState(''); const [amount,setAmount]=useState(''); const [lastGen,setLastGen]=useState(null);
  const [genMonth,setGenMonth]=useState(new Date()); const [genStart,setGenStart]=useState(''); const [genEnd,setGenEnd]=useState('');
  const [scanMonth,setScanMonth]=useState(new Date()); const [scanStart,setScanStart]=useState(''); const [scanEnd,setScanEnd]=useState('');
  const [scanning,setScanning]=useState(false);
  const [scannedData,setScannedData]=useState(null); const [purchaseAmt,setPurchaseAmt]=useState(''); const [manualQR,setManualQR]=useState('');
  const [selectedScanRec,setSelectedScanRec]=useState(null); const [addingPurchaseFor,setAddingPurchaseFor]=useState(null);
  const [camHook, setCamHook] = useState([null, null]);

  useEffect(()=>{ (async()=>{ const u=await AsyncStorage.getItem(KEYS.USER); const g=await AsyncStorage.getItem(KEYS.GEN); const s=await AsyncStorage.getItem(KEYS.SCAN); if(u) setUser(JSON.parse(u)); if(g) setGenRecords(JSON.parse(g)); if(s) setScanRecords(JSON.parse(s)); })(); },[]);
  
  useEffect(()=>{
    if(useCameraPermissions){
      try { const hook = useCameraPermissions(); setCamHook(hook); } catch {}
    }
  },[scanning]);

  const permission = camHook[0];
  const requestPermission = camHook[1];

  const saveGen=async(arr)=>{ setGenRecords(arr); await AsyncStorage.setItem(KEYS.GEN, JSON.stringify(arr)); };
  const saveScan=async(arr)=>{ setScanRecords(arr); await AsyncStorage.setItem(KEYS.SCAN, JSON.stringify(arr)); };
  const handleRegister=async()=>{ if(!nameInput.trim()||!phoneInput.trim()) return Alert.alert('Enter name and phone'); const u={name:nameInput.trim(), phone:phoneInput.trim()}; await AsyncStorage.setItem(KEYS.USER, JSON.stringify(u)); setUser(u); };
  const doGenerate=async()=>{ if(!custName.trim()||!amount.trim()) return Alert.alert('Enter customer and amount'); const amt=parseFloat(amount); if(isNaN(amt)||amt<=0) return Alert.alert('Invalid amount'); const now=new Date(); const rec={qr_id:uid(), generated_by:user.name, customer_name:custName.trim(), cover_amount:amt, generated_date:now.toISOString().slice(0,10), generated_time:now.toTimeString().slice(0,8), generated_at:now.toISOString()}; const arr=[rec,...genRecords]; await saveGen(arr); setLastGen(rec); setCustName(''); setAmount(''); };

  const validateQR=(payload)=>{ try{ const obj=typeof payload==='string'?JSON.parse(payload):payload; if(!obj.qr_id||!obj.generated_by||!obj.customer_name||obj.cover_amount==null||!obj.generated_at) return {valid:false, reason:'NOT_RECOGNISED'}; const genTime=new Date(obj.generated_at).getTime(); if(isNaN(genTime)) return {valid:false, reason:'NOT_RECOGNISED'}; if(genTime>Date.now()+60000) return {valid:false, reason:'NOT_RECOGNISED'}; if(Date.now()-genTime>EXPIRY_MS) return {valid:false, reason:'EXPIRED'}; return {valid:true, data:obj}; }catch{ return {valid:false, reason:'NOT_RECOGNISED'}; } };

  const processScannedQR=async(raw)=>{ const v=validateQR(raw); if(!v.valid){ Alert.alert(v.reason==='EXPIRED'?'INVALID QR CODE — EXPIRED':'INVALID QR CODE — NOT RECOGNISED'); setScanning(false); return; } const data=v.data; const existingIdx=scanRecords.findIndex(r=> r.qr_id===data.qr_id); if(existingIdx>=0){ const rec=scanRecords[existingIdx]; rec.last_scanned_at=new Date().toISOString(); rec.scan_count=(rec.scan_count||1)+1; await saveScan([...scanRecords]); setScannedData(rec); setScanning(false); return; } const newRec={internal_id:uid(), qr_id:data.qr_id, customer_name:data.customer_name, generated_by:data.generated_by, cover_amount:data.cover_amount, generated_date:data.generated_date, generated_time:data.generated_time, generated_at:data.generated_at, first_scanned_at:new Date().toISOString(), first_scanned_date:new Date().toISOString().slice(0,10), last_scanned_at:new Date().toISOString(), scan_count:1, purchases:[]}; const arr=[newRec,...scanRecords]; await saveScan(arr); setScannedData(newRec); setScanning(false); };

  const handlePurchase=async()=>{ const target=addingPurchaseFor||scannedData||selectedScanRec; if(!target) return; const amt=parseFloat(purchaseAmt); if(isNaN(amt)||amt<=0) return Alert.alert('Enter valid amount'); const totalPurchased=(target.purchases||[]).reduce((s,p)=>s+p.amount,0); const remaining=target.cover_amount-totalPurchased; if(amt>remaining) return Alert.alert('Purchase exceeds remaining ₹'+remaining); const now=new Date(); const tx={id:uid(), amount:amt, date:now.toISOString().slice(0,10), time:now.toTimeString().slice(0,8), at:now.toISOString()}; const updated=scanRecords.map(r=> r.qr_id===target.qr_id?{...r, purchases:[...r.purchases, tx], last_scanned_at:now.toISOString()}:r); await saveScan(updated); setPurchaseAmt(''); setScannedData(null); setAddingPurchaseFor(null); setSelectedScanRec(updated.find(r=> r.qr_id===target.qr_id)); setTab('history'); };

  if(!user){ return (<View style={[styles.root,{justifyContent:'center'}]}><Text style={styles.bigTitle}>COVER MANAGER</Text><Text style={styles.sub}>Hospitality POS • QR System</Text><View style={styles.card}><TextInput style={styles.input} placeholder="Your Name" placeholderTextColor="#777" value={nameInput} onChangeText={setNameInput}/><TextInput style={styles.input} placeholder="Phone Number" placeholderTextColor="#777" value={phoneInput} onChangeText={setPhoneInput} keyboardType="phone-pad"/><TouchableOpacity style={styles.btn} onPress={handleRegister}><Text style={styles.btnTxt}>Continue</Text></TouchableOpacity></View></View>); }

  const genMarkers=[...new Set(genRecords.map(r=> r.generated_date))]; const scanMarkers=[...new Set(scanRecords.map(r=> r.first_scanned_date))];
  const filteredGen=genRecords.filter(r=>{ if(!genStart) return true; if(!genEnd) return r.generated_date===genStart; return r.generated_date>=genStart && r.generated_date<=genEnd; }); const genTotalAmt=filteredGen.reduce((s,r)=>s+r.cover_amount,0);
  const filteredScanFirst=scanRecords.filter(r=>{ if(!scanStart) return true; if(!scanEnd) return r.first_scanned_date===scanStart; return r.first_scanned_date>=scanStart && r.first_scanned_date<=scanEnd; });
  const filteredPurchasesInRange=scanRecords.flatMap(r=> r.purchases.map(p=> ({...p, _rec:r}))).filter(p=>{ if(!scanStart) return true; if(!scanEnd) return p.date===scanStart; return p.date>=scanStart && p.date<=scanEnd; });
  const scanTotalPurchases=filteredPurchasesInRange.reduce((s,p)=>s+p.amount,0);
  const scanTotalRemaining=filteredScanFirst.reduce((s,r)=> s + (r.cover_amount - r.purchases.reduce((a,b)=>a+b.amount,0)), 0);

  return (
    <View style={styles.root}>
      <View style={styles.topBar}><Text style={styles.topBarTxt}>{user.name} • {user.phone}</Text></View>
      <View style={styles.tabs}>{['generate','scan','history','statistics'].map(t=>(<TouchableOpacity key={t} style={[styles.tab, tab===t&&styles.tabActive]} onPress={()=> setTab(t)}><Text style={[styles.tabTxt, tab===t&&styles.tabTxtActive]}>{t.toUpperCase()}</Text></TouchableOpacity>))}</View>
      {tab==='generate'&&(<ScrollView contentContainerStyle={styles.scroll}>{!lastGen?(<View style={styles.card}><Text style={styles.label}>Customer Name</Text><TextInput style={styles.input} placeholder="e.g. Alex" placeholderTextColor="#777" value={custName} onChangeText={setCustName}/><Text style={styles.label}>Cover Amount (INR)</Text><TextInput style={styles.input} placeholder="1000" placeholderTextColor="#777" value={amount} onChangeText={setAmount} keyboardType="numeric"/><TouchableOpacity style={styles.btn} onPress={doGenerate}><Text style={styles.btnTxt}>Generate QR Code</Text></TouchableOpacity></View>):(<View style={styles.card}><View style={{alignItems:'center'}}><QRCode value={JSON.stringify(lastGen)} size={240} /></View><Text style={styles.detail}>Customer: {lastGen.customer_name}</Text><Text style={styles.detail}>Cover: ₹{lastGen.cover_amount}</Text><Text style={styles.detailMuted}>By {lastGen.generated_by} • {lastGen.generated_date} {lastGen.generated_time}</Text><Text style={styles.detailMuted}>ID: {lastGen.qr_id}</Text><TouchableOpacity style={[styles.btn,{marginTop:16}]} onPress={()=> setLastGen(null)}><Text style={styles.btnTxt}>Generate Another</Text></TouchableOpacity></View>)}<Text style={styles.section}>Generator Statistics</Text><View style={styles.card}><Calendar selectedStart={genStart} selectedEnd={genEnd} markers={genMarkers} month={genMonth} setMonth={setGenMonth} onSelectDate={(ds)=>{ if(!genStart||(genStart&&genEnd)){ setGenStart(ds); setGenEnd(''); }else{ if(ds<genStart){ setGenEnd(genStart); setGenStart(ds);}else setGenEnd(ds); }}}/><View style={styles.row}><TouchableOpacity style={styles.chip} onPress={()=>{ const t=new Date().toISOString().slice(0,10); setGenStart(t); setGenEnd(t);}}><Text style={styles.chipTxt}>Today</Text></TouchableOpacity><TouchableOpacity style={styles.chip} onPress={()=>{ setGenStart(''); setGenEnd('');}}><Text style={styles.chipTxt}>Clear</Text></TouchableOpacity></View><Text style={styles.stat}>Total QR Generated: {filteredGen.length}</Text><Text style={styles.stat}>Total Amount: ₹{genTotalAmt}</Text><FlatList data={filteredGen} scrollEnabled={false} keyExtractor={i=>i.qr_id} renderItem={({item})=><View style={styles.rowLine}><Text style={styles.rowTxt}>{item.customer_name}</Text><Text style={styles.rowTxt}>₹{item.cover_amount}</Text><Text style={styles.rowMuted}>{item.generated_date}</Text></View>}/></View></ScrollView>)}
      {tab==='scan'&&(<ScrollView contentContainerStyle={styles.scroll}><View style={styles.card}><TouchableOpacity style={styles.btn} onPress={async()=>{ if(Platform.OS==='web'){ Alert.alert('Camera not available on web - use paste box below'); return; } if(requestPermission){ const res = await requestPermission(); if(!res.granted) { Alert.alert('Camera permission needed'); return; } } setScanning(true);}}><Text style={styles.btnTxt}>Open QR Scanner</Text></TouchableOpacity><Text style={styles.or}>— OR paste for web testing —</Text><TextInput style={[styles.input,{height:80}]} multiline placeholder="Paste raw QR JSON" placeholderTextColor="#777" value={manualQR} onChangeText={setManualQR}/><TouchableOpacity style={styles.btnSec} onPress={()=> processScannedQR(manualQR)}><Text style={styles.btnSecTxt}>Read QR Data</Text></TouchableOpacity></View>{scanning&&Platform.OS!=='web'&&CameraView&&(<View style={styles.card}><CameraView style={{height:300, borderRadius:12}} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=> processScannedQR(data)} /><TouchableOpacity style={styles.btnSec} onPress={()=> setScanning(false)}><Text style={styles.btnSecTxt}>Close Camera</Text></TouchableOpacity></View>)}{scannedData&&(<View style={styles.card}><Text style={styles.bigName}>{scannedData.customer_name}</Text><Text style={styles.detail}>Original Cover: ₹{scannedData.cover_amount}</Text><Text style={styles.detail}>Remaining: ₹{scannedData.cover_amount - scannedData.purchases.reduce((s,p)=>s+p.amount,0)}</Text><Text style={styles.label}>Purchase Amount</Text><TextInput style={styles.input} placeholder="Enter amount" placeholderTextColor="#777" value={purchaseAmt} onChangeText={setPurchaseAmt} keyboardType="numeric"/><TouchableOpacity style={styles.btn} onPress={handlePurchase}><Text style={styles.btnTxt}>GO - Deduct</Text></TouchableOpacity></View>)}</ScrollView>)}
      {tab==='history'&&(<ScrollView contentContainerStyle={styles.scroll}>{selectedScanRec?(<View style={styles.card}><TouchableOpacity onPress={()=> setSelectedScanRec(null)}><Text style={styles.back}>‹ Back</Text></TouchableOpacity><Text style={styles.bigName}>{selectedScanRec.customer_name}</Text><Text style={styles.detail}>Original: ₹{selectedScanRec.cover_amount}</Text><Text style={styles.detail}>Total Purchased: ₹{selectedScanRec.purchases.reduce((s,p)=>s+p.amount,0)}</Text><Text style={[styles.detail,{color:'#C6FF00'}]}>Remaining: ₹{selectedScanRec.cover_amount - selectedScanRec.purchases.reduce((s,p)=>s+p.amount,0)}</Text><Text style={styles.section}>Purchase History</Text>{selectedScanRec.purchases.map(p=><View key={p.id} style={styles.rowLine}><Text style={styles.rowTxt}>₹{p.amount}</Text><Text style={styles.rowMuted}>{p.date} {p.time}</Text></View>)}{!addingPurchaseFor?(<TouchableOpacity style={styles.btn} onPress={()=> setAddingPurchaseFor(selectedScanRec)}><Text style={styles.btnTxt}>Add Another Purchase</Text></TouchableOpacity>):(<View><TextInput style={styles.input} placeholder="Amount" placeholderTextColor="#777" value={purchaseAmt} onChangeText={setPurchaseAmt} keyboardType="numeric"/><TouchableOpacity style={styles.btn} onPress={handlePurchase}><Text style={styles.btnTxt}>Confirm</Text></TouchableOpacity></View>)}</View>):(scanRecords.map(rec=>{ const rem=rec.cover_amount - rec.purchases.reduce((s,p)=>s+p.amount,0); return (<TouchableOpacity key={rec.internal_id} style={styles.listCard} onPress={()=> setSelectedScanRec(rec)}><View style={{flex:1}}><Text style={styles.listName}>{rec.customer_name}</Text><Text style={styles.listMuted}>Last {new Date(rec.last_scanned_at).toLocaleString()}</Text></View><View><Text style={styles.listAmt}>₹{rem} left</Text></View><Text style={styles.chev}>›</Text></TouchableOpacity>);}))}</ScrollView>)}
      {tab==='statistics'&&(<ScrollView contentContainerStyle={styles.scroll}><View style={styles.card}><Calendar selectedStart={scanStart} selectedEnd={scanEnd} markers={scanMarkers} month={scanMonth} setMonth={setScanMonth} onSelectDate={(ds)=>{ if(!scanStart||(scanStart&&scanEnd)){ setScanStart(ds); setScanEnd(''); }else{ if(ds<scanStart){ setScanEnd(scanStart); setScanStart(ds);}else setScanEnd(ds); }}}/><View style={styles.row}><TouchableOpacity style={styles.chip} onPress={()=>{ const t=new Date().toISOString().slice(0,10); setScanStart(t); setScanEnd(t);}}><Text style={styles.chipTxt}>Today</Text></TouchableOpacity><TouchableOpacity style={styles.chip} onPress={()=>{ setScanStart(''); setScanEnd('');}}><Text style={styles.chipTxt}>Clear</Text></TouchableOpacity></View><Text style={styles.stat}>Total QR Scanned (unique): {filteredScanFirst.length}</Text><Text style={styles.stat}>Total Purchases (in range): ₹{scanTotalPurchases}</Text><Text style={styles.stat}>Total Remaining: ₹{scanTotalRemaining}</Text><FlatList data={filteredScanFirst} scrollEnabled={false} keyExtractor={i=>i.internal_id} renderItem={({item})=>{ const rem=item.cover_amount - item.purchases.reduce((s,p)=>s+p.amount,0); return <TouchableOpacity style={styles.rowLine} onPress={()=> { setSelectedScanRec(item); setTab('history');}}><Text style={styles.rowTxt}>{item.customer_name}</Text><Text style={styles.rowTxt}>₹{item.cover_amount} → ₹{rem}</Text></TouchableOpacity>; }}/></View></ScrollView>)}
    </View>
  );
}

const styles=StyleSheet.create({
  root:{flex:1, backgroundColor:'#0E0E0E'}, bigTitle:{color:'#fff', fontSize:28, fontWeight:'800', textAlign:'center'}, sub:{color:'#777', textAlign:'center', marginBottom:24, marginTop:8},
  card:{backgroundColor:'#181818', borderRadius:16, padding:16, margin:12, borderWidth:1, borderColor:'#222'}, input:{backgroundColor:'#111', color:'#fff', borderRadius:12, padding:14, borderWidth:1, borderColor:'#2a2a2a', marginTop:8},
  label:{color:'#9a9a9a', marginTop:12, fontSize:12}, btn:{backgroundColor:'#C6FF00', borderRadius:12, padding:14, alignItems:'center', marginTop:12}, btnTxt:{color:'#000', fontWeight:'800'},
  btnSec:{backgroundColor:'#222', borderRadius:12, padding:14, alignItems:'center', marginTop:12, borderWidth:1, borderColor:'#333'}, btnSecTxt:{color:'#fff', fontWeight:'700'},
  topBar:{padding:12, backgroundColor:'#111', borderBottomWidth:1, borderColor:'#222'}, topBarTxt:{color:'#888', fontSize:12},
  tabs:{flexDirection:'row', backgroundColor:'#111', padding:4}, tab:{flex:1, padding:10, alignItems:'center', borderRadius:10}, tabActive:{backgroundColor:'#1e1e1e', borderWidth:1, borderColor:'#333'},
  tabTxt:{color:'#666', fontSize:11, fontWeight:'700'}, tabTxtActive:{color:'#C6FF00'}, scroll:{paddingBottom:100},
  detail:{color:'#fff', marginTop:6}, detailMuted:{color:'#777', marginTop:4, fontSize:12}, bigName:{color:'#fff', fontSize:22, fontWeight:'800'},
  section:{color:'#C6FF00', fontWeight:'800', marginTop:20, marginLeft:12}, stat:{color:'#fff', marginTop:8}, row:{flexDirection:'row', gap:8, marginTop:12},
  chip:{backgroundColor:'#222', paddingVertical:6, paddingHorizontal:12, borderRadius:20, borderWidth:1, borderColor:'#333'}, chipTxt:{color:'#fff', fontSize:12},
  rowLine:{flexDirection:'row', justifyContent:'space-between', paddingVertical:10, borderBottomWidth:1, borderColor:'#222'}, rowTxt:{color:'#fff', fontSize:13}, rowMuted:{color:'#666', fontSize:12},
  listCard:{backgroundColor:'#181818', marginHorizontal:12, marginVertical:6, borderRadius:14, padding:14, flexDirection:'row', alignItems:'center', borderWidth:1, borderColor:'#222'},
  listName:{color:'#fff', fontWeight:'700'}, listMuted:{color:'#777', fontSize:11, marginTop:2}, listAmt:{color:'#C6FF00', fontWeight:'800', textAlign:'right'}, chev:{color:'#444', fontSize:20, marginLeft:12}, back:{color:'#C6FF00', marginBottom:12},
  calWrap:{marginBottom:12}, calHeader:{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12}, calTitle:{color:'#fff', fontWeight:'700'}, calNav:{color:'#C6FF00', fontSize:22, paddingHorizontal:12},
  calGrid:{flexDirection:'row', flexWrap:'wrap'}, calDow:{width:'14.28%', textAlign:'center', color:'#555', fontSize:11, paddingVertical:4}, calCell:{width:'14.28%', aspectRatio:1, alignItems:'center', justifyContent:'center', borderRadius:8, marginVertical:2}, calSel:{backgroundColor:'#C6FF00'}, calDay:{color:'#fff', fontSize:13}, calDaySel:{color:'#000', fontWeight:'800'}, dot:{width:4, height:4, borderRadius:2, backgroundColor:'#C6FF00', marginTop:2, position:'absolute', bottom:4}, or:{color:'#555', textAlign:'center', marginTop:16, fontSize:12}
});
