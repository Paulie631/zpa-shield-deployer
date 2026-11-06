// Starts the real Express app with Zscaler + CloudShare HTTP calls faked.
// Stand-in for Zscaler, CloudShare and AWS: runs the real Express app with every outbound call faked.
// Used by test/e2e.js. Never talks to a real service.
const path=require('path');const root=path.resolve(__dirname,'..');const axios=require(root+'/node_modules/axios');const {execSync}=require('child_process');const fs=require('fs');
const out={};let n=0;const zdb={};const zkey=u=>{const x=u.match(/customers\/\d+\/(.+)$/);return x?x[1]:null};let vms=[{id:'V1',name:'zpa-connector-el9-2026.05',os:'Linux',cpuCount:4,memorySizeMb:4096,diskSizeGb:64,statusText:'Running',internalAddresses:['10.0.0.5'],username:'admin',password:'x'}];
const ok=d=>({data:d});
axios.post=async(u,b)=>{ if(u.includes('/ziam/')){ if(/\/groups$/.test(u)){const g={id:'G'+(zid.groups.length+1),name:b.name};zid.groups.push(g);return ok(g);} const m=u.match(/\/groups\/(\w+)\/users\/(\w+)$/); if(m){const g=zid.groups.find(x=>x.id===m[1]);(zid.members[m[2]]=zid.members[m[2]]||[]).push(g.name);return ok({});} return ok({}); }
  if(u.endsWith('/api/v3/envs')) return ok({environmentId:'E2'});
  if(u.includes('zslogin')) return ok({access_token:'a.b.c'});
  if(u.includes('executepath')){const id='e'+(++n);let o='';
    if(b.path.startsWith('powershell')){ out[id]= b.vmId==='W1' ? ['ZCC: Zscaler Service=Running','URL http://172.31.5.5/ -> 302','URL http://172.31.5.5:3000/ -> 200','URL http://10.0.0.5/ -> 302','URL http://10.0.0.5:3000/ -> 200'].join(String.fromCharCode(10)) : ''; return ok({executionId:id}); }
    if(b.path.includes('| base64 -d | bash')){ out[id]= b.vmId==='V2' ? ['IPS: 10.0.0.9/24','ROUTE: NONE','NAMESERVERS: 127.0.0.53','DNS: FAIL','PING: FAIL','HTTPS: 000'].join(String.fromCharCode(10)) : ['IPS: 10.0.0.4/24','ROUTE: default via 10.0.0.1 dev eth0','NAMESERVERS: 10.0.0.1','DNS: OK','PING: OK','HTTPS: 401'].join(String.fromCharCode(10)); return ok({executionId:id}); }
    if(b.path.includes('setsid nohup')){const job=b.path.match(/\/tmp\/(zpa-[a-z]+)\.sh/)[1];fs.writeFileSync(`/tmp/${job}.log`, job==='zpa-traffic'?'=== Step 4 ===\nConnector setup complete!\n':job==='zpa-testapps'?'=== Step 4 ===\nport 80 -> HTTP 200\nVM_IPS: 10.0.0.9 172.17.0.1\nTest apps ready!\n':'=== Step 6 ===\n Setup complete!\n');o='STARTED';}
    else{try{o=execSync(b.path,{shell:'/bin/sh'}).toString()}catch(e){o=String(e.stdout||'')}}
    out[id]=o;return ok({executionId:id});}
  if(u.includes('/appProtection/')){const e=new Error('Request failed with status code 404');e.response={status:404,data:{id:'resource.not.found',reason:'No handler found'}};throw e;}
  if(u.includes('/provisioningKey')) return ok({id:'pk1',name:b.name,provisioningKey:'3|api.private.zscaler.com|FAKEKEY=='});
  const k=zkey(u);const o={id:'z'+(++n),disabled:'0',...b};if(k){(zdb[k]=zdb[k]||[]).push(o);if(/policySet\/[^/]+\/rule$/.test(k))(zdb['policySet/rules/policyType/ACCESS_POLICY']=zdb['policySet/rules/policyType/ACCESS_POLICY']||[]).push(o);}
  return ok(o);};
axios.put=async(u,b)=>{ if(/\/connector\/C1$/.test(u)){Object.assign(shieldConn,b);return ok({});} if(/\/serverGroup\/[^/]+$/.test(u)&&b.appConnectorGroups?.length){const last=b.appConnectorGroups[b.appConnectorGroups.length-1].id;if(!/traffic/i.test(JSON.stringify(b.appConnectorGroups.slice(-1))))shieldConn.appConnectorGroupId=last;} if(u.endsWith('/api/v3/envs')){const nm=b.itemsCart[0].name;vms.push({id: b.itemsCart[0].type===4?'V4':(nm.includes('Scanner')?'V3':'V2'),name:nm,os:'Linux',cpuCount:2,memorySizeMb:4096,diskSizeGb:40,statusText:'Running',internalAddresses:[nm.includes('Scanner')?'10.0.0.7':'10.0.0.9']});return ok({environmentId:b.envId});}
  if(u.includes('editvmhardware')){const v=vms.find(x=>x.id===b.vmId);v.cpuCount=b.numCpus;v.memorySizeMb=b.memorySizeMBs;v.diskSizeGb=b.diskSizeGBs;return ok({conflictsFound:false});} return ok({});};
// Zidentity: one hosted user, no groups, ZIA only until added to the entitlement group (then ZPA appears)
const zid={groups:[],members:{}};
// ZPA connectors: one App Scanner connector with App Shield scanning off until the wizard turns it on
const shieldConn={id:'C1',name:'ZPA-AppScanner-Key-1',appConnectorGroupId:'new1',controlChannelStatus:'ZPN_STATUS_AUTHENTICATED',appShieldScanningEnabled:false};
axios.get=async(u,c)=>{ if(/\/connector$/.test(u)) return ok({list:[shieldConn],totalPages:'1'}); if(/\/connector\/C1$/.test(u)) return ok({...shieldConn});
  if(u.includes('/ziam/')){ if(/\/users$/.test(u)) return ok({records:(c.params.loginName||c.params['loginName[like]']||'').startsWith('ztest')?[{id:'U1',loginName:'ztest@example.com',displayName:'Z Test',status:'ACTIVE',source:'HOSTED'}]:[]});
    if(u.endsWith('/service-entitlements')) return ok({records:[{service:{serviceName:'ZIA',cloudName:'zscalerthree.net'}}].concat((zid.members.U1||[]).includes('ZPA Shield Test Users')?[{service:{serviceName:'ZPA',cloudName:'private.zscaler.com'}}]:[])});
    if(/\/users\/U1\/groups$/.test(u)) return ok({records:(zid.members.U1||[]).map(n=>({name:n}))});
    if(/\/groups$/.test(u)) return ok({records:zid.groups}); return ok({records:[]}); }
  if(/\/projects\/[^/]+\/blueprints$/.test(u)) return ok([{id:'BP1',name:'App Connector Base'},{id:'BPZ',name:'Windows 11 - ZCC'}]);
  if(u.includes('getextended')&&u.includes('E2')) return ok({id:'E2',name:'ZPA Test Client',statusText:'Ready',regionId:'R1',vms:[{id:'W1',name:'win11-zcc',os:'Windows 11',statusText:'Running',webAccessUrl:'https://use.cloudshare.com/x'}]});
  if(u.includes('/blueprints/')) return ok({createFromVersions:[{id:'SS1',name:'v2026.05',isDefault:true,machines:[{id:'MC1',name:'zpa-connector-el9-2026.05',osTypeName:'Linux',resources:{cpuCount:4,memorySizeMB:4096}}]}]});
  if(u.includes('checkexecutionstatus')) return ok({success:true,standardOutput:out[new URL(u).searchParams.get('executionId')]});
  if(u.includes('getextended')) return ok({id:'E1',name:'ZPA App Scanner',statusText:'Ready',projectName:'SE Labs',regionId:'R1',vms});
  if(u.includes('/api/v3/templates')) return ok([{id:'T0',name:'Ubuntu 16.04 Server',regionId:'R1',resources:{cpuCount:2,memorySizeMB:4096}},{id:'T1',name:'Ubuntu 22.04 Server',regionId:'R1',resources:{cpuCount:2,memorySizeMB:4096}},{id:'T4',name:'Red Hat Enterprise Linux 9.4',regionId:'R1',resources:{cpuCount:2,memorySizeMB:4096}},{id:'T2',name:'Windows Server 2022',regionId:'R1',resources:{cpuCount:4,memorySizeMB:8192}},{id:'T3',name:'CentOS 9 Stream',regionId:'R1',resources:{cpuCount:2,memorySizeMB:4096}}]);
  if(u.includes('/api/v3/envs')) return ok([{id:'E1',name:'ZPA App Scanner'}]);
  if(/\/v2\/.*\/idp$/.test(u)) return ok({list:[{id:'I1',name:'Zidentity',enabled:true,ssoType:['USER','ADMIN'],domainList:['example.com']}],totalPages:'1'});
  if(u.includes('enrollmentCert')) return ok({list:[{id:'42',name:'Connector'}]});
  if(u.endsWith('policySet/policyType/ACCESS_POLICY')) return ok({id:'PS1'});
  if(u.endsWith('/appConnectorGroup')) return ok({list:[{id:'new1',name:'ZPA-AppScanner-Group'},{id:'CG2',name:'Traffic Connectors'}]});
  if(u.endsWith('/application')) return ok({list:[{id:'S1',name:'DVWA',domainNames:['10.0.0.9']},{id:'S2',name:'Juice Shop',domainNames:['10.0.0.9']}]});
  const k=zkey(u);if(k&&zdb[k])return ok({list:zdb[k],totalPages:'1'});
  return ok({list:[]});};
global.AWSCALLS=[];const sts=require(root+'/node_modules/@aws-sdk/client-sts');sts.STSClient.prototype.send=async function(){const c=await this.config.credentials();return {Account:'123456789012',Arn:'arn:aws:sts::123456789012:assumed-role/Sandbox/paul'}};
const cf=require(root+'/node_modules/@aws-sdk/client-cloudformation'),e2=require(root+'/node_modules/@aws-sdk/client-ec2'),sm=require(root+'/node_modules/@aws-sdk/client-ssm');
let stacks={};
cf.CloudFormationClient.prototype.send=async c=>{const n=c.constructor.name;AWSCALLS.push(n);
  if(n==='CreateStackCommand'){const t=JSON.parse(c.input.TemplateBody);const inst=Object.values(t.Resources).find(r=>r.Type==='AWS::EC2::Instance');stacks[c.input.StackName]={ami:inst.Properties.ImageId,ud:Buffer.from(inst.Properties.UserData,'base64').toString()};console.log('STACK',c.input.StackName,inst.Properties.ImageId,'userdata has docker-ce:',stacks[c.input.StackName].ud.includes('docker-ce'),'awscli:',stacks[c.input.StackName].ud.includes('awscli'));return {};}
  if(n==='DescribeStacksCommand') return {Stacks:[{StackStatus:'CREATE_COMPLETE',Outputs:[{OutputKey:'PrivateIp',OutputValue:'172.31.5.5'}]}]};};
e2.EC2Client.prototype.send=async c=>{const n=c.constructor.name;AWSCALLS.push(n);
  if(n==='DescribeImagesCommand') return {Images:[{ImageId:'ami-old',Name:'RHEL-9.2.0_HVM-2023-x86_64-1-Hourly2-GP2',CreationDate:'2023-05-01'},{ImageId:'ami-new9',Name:'RHEL-9.6.0_HVM-2025-x86_64-1-Hourly2-GP3',CreationDate:'2025-09-01'},{ImageId:'ami-beta',Name:'RHEL-9.7.0_HVM_BETA-2026-x86_64',CreationDate:'2026-01-01'}]};
  if(n==='DescribeVpcsCommand') return {Vpcs:[{VpcId:'vpc-1',CidrBlock:'172.31.0.0/16',IsDefault:true,Tags:[]}]};
  if(n==='DescribeSubnetsCommand') return {Subnets:[{SubnetId:'subnet-1',VpcId:'vpc-1',CidrBlock:'172.31.0.0/20',AvailabilityZone:'us-west-2a',Tags:[]}]};
  if(n==='DescribeKeyPairsCommand') return {KeyPairs:[{KeyName:'paul-key'}]}; return {};};
sm.SSMClient.prototype.send=async c=>{AWSCALLS.push(c.constructor.name);return {};};
process.chdir(root);require(root+'/server/index.js');
