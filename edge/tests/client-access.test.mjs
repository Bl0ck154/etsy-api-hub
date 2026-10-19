import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceClient,authenticateServiceClient,requireServiceAccess,revokeServiceClient,listServiceClients } from '../client-access.mjs';

const fakeDb = () => {
  const clients = new Map();
  return {
    clients,
    prepare(sql) {
      return { bind(...params) {
        return {
          async run() {
            if (sql.startsWith('INSERT INTO hub_clients')) {
              const [id,name,token_hash,scopes,shops,path_prefixes,created_at]=params;
              clients.set(id,{id,name,token_hash,scopes,shops,path_prefixes,created_at,revoked_at:null,last_used_at:null});
              return {meta:{changes:1}};
            }
            if (sql.startsWith('UPDATE hub_clients SET revoked_at')) {
              const [at,id]=params;
              const row=clients.get(id);
              if (!row || row.revoked_at) return {meta:{changes:0}};
              row.revoked_at=at;
              return {meta:{changes:1}};
            }
            throw new Error('Unexpected fake SQL run: ' + sql);
          },
          async first() {
            if (sql.startsWith('SELECT * FROM hub_clients WHERE id=')) {
              const row=clients.get(params[0]);
              return row && row.revoked_at===null ? row : null;
            }
            throw new Error('Unexpected fake SQL first: '+sql);
          },
          async all() {
            if (sql.startsWith('SELECT id,name,scopes,shops,path_prefixes')) return {results:[...clients.values()]};
            throw new Error('Unexpected fake SQL all: '+sql);
          }
        };
      }};
    }
  };
};
const setup = () => ({DB:fakeDb(),SHOPS_JSON:JSON.stringify({main:{shop_id:'23207964'},second:{shop_id:'33448161'}}),ENABLE_WRITES:'false'});
const bearer = token => new Request('https://test.example/v1/request',{headers:{Authorization:'Bearer '+token}});
const caseRequest = (shop='main',path='/application/shops/23207964/receipts') => ({shop,path});
test('tokens are scoped, random and stored as non-reversible hashes',async () => {
  const env=setup();
  const c=await createServiceClient(env,{name:'Order Forge read',shops:['main'],path_prefixes:['/application/shops/23207964/receipts']});
  assert.match(c.token,/^hubc_[0-9a-f-]{36}\.[0-9a-f]{64}$/);
  assert.equal((await listServiceClients(env))[0].token,undefined);
  assert.equal(JSON.stringify([...env.DB.clients.values()]).includes(c.token),false);
  const a=await authenticateServiceClient(bearer(c.token),env);
  assert.equal(a.name,'Order Forge read');
  assert.deepEqual(requireServiceAccess(a,env,caseRequest(),'GET'),{shop:'main',method:'GET',apiPath:'/application/shops/23207964/receipts'});
  assert.throws(() => requireServiceAccess(a,env,caseRequest('second'),'GET'),/Shop access denied/);
  assert.throws(() => requireServiceAccess(a,env,caseRequest('main','/application/shops/23207964/receiptsExtra'),'GET'),/endpoint not permitted/);
  assert.throws(() => requireServiceAccess(a,env,caseRequest('main','/application/shops/23207964/listings'),'GET'),/endpoint not permitted/);
  assert.throws(() => requireServiceAccess(a,env,caseRequest(),'DELETE'),/Writes disabled/);
  env.ENABLE_WRITES='true';
  assert.throws(() => requireServiceAccess(a,env,caseRequest(),'DELETE'),/Write access denied/);
  assert.equal(await revokeServiceClient(env,c.id),true);
  assert.equal(await authenticateServiceClient(bearer(c.token),env),null);
  assert.equal(await revokeServiceClient(env,c.id),false);
});
test('write permissions require explicit owner confirmation',async () => {
  const env=setup();
  await assert.rejects(createServiceClient(env,{name:'writer',shops:['main'],path_prefixes:['/application/shops/23207964/receipts'],scopes:['read','write']}),/Explicit write confirmation required/);
  const c=await createServiceClient(env,{name:'writer',shops:['main'],path_prefixes:['/application/shops/23207964/receipts'],scopes:['read','write'],confirm_writes:true});
  const a=await authenticateServiceClient(bearer(c.token),env);
  env.ENABLE_WRITES='true';
  assert.equal(requireServiceAccess(a,env,caseRequest(),'POST').method,'POST');
  assert.throws(() => requireServiceAccess(a,env,caseRequest(),'POST',true),/Media upload access denied/);
});
test('cannot create universal or cross-shop credentials accidentally',async () => {
  const env=setup();
  await assert.rejects(createServiceClient(env,{name:'bot',shops:[],path_prefixes:['/application/shops/']}),/Select existing shops explicitly/);
  await assert.rejects(createServiceClient(env,{name:'bot',shops:['not-ours'],path_prefixes:['/application/shops/']}),/Select existing shops explicitly/);
  await assert.rejects(createServiceClient(env,{name:'bot',shops:['main'],path_prefixes:[]}),/Specify permitted Etsy API path prefixes/);
  await assert.rejects(createServiceClient(env,{name:'bot',shops:['main'],path_prefixes:['/application/shops/../admin']}),/Invalid Etsy path restriction/);
  await assert.rejects(createServiceClient(env,{name:'bot',shops:['main'],path_prefixes:['/application/shops/'],scopes:['media']}),/Media requires write permission/);
  assert.throws(()=>requireServiceAccess(null,env,caseRequest(),'GET'),/Service access token required/);
});
