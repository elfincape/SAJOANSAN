import assert from 'node:assert/strict';
import { validateAssignments } from '../repo-root/js/pdf-image-assignment.js';

const drivers = [{ id: 'driver-1', center_code: '001' }, { id: 'driver-2', center_code: '002' }];
const companies = [{ id: 'company-1', center_code: '001' }, { id: 'company-2', center_code: '002' }];
const shared = { driverId: 'driver-1', center: '001', companyId: 'company-1', expiry: '' };
const assignment = { pageNumber: 1, selected: true, kind: 'identity' };
assert.deepEqual(validateAssignments([assignment], shared, drivers, companies), [{ ...assignment, ...shared }]);
assert.deepEqual(validateAssignments([assignment, { pageNumber: 2, selected: false, kind: '' }], shared, drivers, companies), [{ ...assignment, ...shared }]);
assert.deepEqual(validateAssignments([assignment, { pageNumber: 2, selected: true, kind: '' }], shared, drivers, companies), [{ ...assignment, ...shared }]);
assert.deepEqual(validateAssignments([assignment, { pageNumber: 2, selected: true, kind: 'skip' }], shared, drivers, companies), [{ ...assignment, ...shared }]);
assert.throws(() => validateAssignments([{ ...assignment, selected: false }], shared, drivers, companies), /등록 대상 페이지/);
assert.throws(() => validateAssignments([{ ...assignment, kind: '' }], shared, drivers, companies), /등록 대상 페이지/);
assert.throws(() => validateAssignments([assignment], { ...shared, driverId: '', companyId: '' }, drivers, companies), /기사 또는 운수사/);
const companyOnly={...shared,driverId:''};
assert.throws(() => validateAssignments([assignment], companyOnly, drivers, companies), /운수사에는/);
for(const kind of ['food_transport','food_transport_back','livestock_transport','livestock_transport_back']){
  const result=validateAssignments([{...assignment,kind}],companyOnly,drivers,companies);
  assert.equal(result[0].driverId,'');assert.equal(result[0].companyId,'company-1');
}
assert.throws(() => validateAssignments([{...assignment,kind:'food_transport'}],{...companyOnly,companyId:'company-2'},drivers,companies),/운수사가 센터/);
assert.throws(() => validateAssignments([assignment], { ...shared, center: '002' }, drivers, companies), /센터가 일치/);
assert.throws(() => validateAssignments([assignment], { ...shared, companyId: 'company-2' }, drivers, companies), /운수사가 센터/);
assert.throws(() => validateAssignments([{ ...assignment, kind: 'health_certificate' }], shared, drivers, companies), /만료일/);
assert.equal(validateAssignments([{ ...assignment, kind: 'health_certificate' }], { ...shared, expiry: '2027-02-28' }, drivers, companies).length, 1);
assert.throws(() => validateAssignments([assignment, { ...assignment, pageNumber: 2 }], shared, drivers, companies), /한 장만/);
for(const kind of ['food_transport_back','livestock_transport_back']){
  assert.equal(validateAssignments(Array.from({length:120},(_,i)=>({...assignment,kind,pageNumber:i+1})),shared,drivers,companies).length,120);
}
assert.equal(validateAssignments([assignment, { ...assignment, pageNumber: 2, kind: 'vehicle_registration' }], shared, drivers, companies).length, 2);
console.log('PDF image assignment checks passed');
