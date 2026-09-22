import assert from 'node:assert/strict';
import { validateAssignments } from '../repo-root/js/pdf-image-assignment.js';

const drivers = [{ id: 'driver-1', center_code: '001' }, { id: 'driver-2', center_code: '002' }];
const companies = [{ id: 'company-1', center_code: '001' }, { id: 'company-2', center_code: '002' }];
const shared = { driverId: 'driver-1', center: '001', companyId: 'company-1', expiry: '' };
const assignment = { pageNumber: 1, selected: true, kind: 'identity' };
assert.deepEqual(validateAssignments([assignment], shared, drivers, companies), [{ ...assignment, ...shared }]);
assert.throws(() => validateAssignments([{ ...assignment, selected: false }], shared, drivers, companies), /페이지를 선택/);
assert.throws(() => validateAssignments([assignment], { ...shared, driverId: '' }, drivers, companies), /기사를 선택/);
assert.throws(() => validateAssignments([assignment], { ...shared, center: '002' }, drivers, companies), /센터가 일치/);
assert.throws(() => validateAssignments([assignment], { ...shared, companyId: 'company-2' }, drivers, companies), /운수사가 센터/);
assert.throws(() => validateAssignments([{ ...assignment, kind: 'health_certificate' }], shared, drivers, companies), /만료일/);
assert.equal(validateAssignments([{ ...assignment, kind: 'health_certificate' }], { ...shared, expiry: '2027-02-28' }, drivers, companies).length, 1);
assert.throws(() => validateAssignments([assignment, { ...assignment, pageNumber: 2 }], shared, drivers, companies), /여러 페이지/);
assert.equal(validateAssignments([assignment, { ...assignment, pageNumber: 2, kind: 'vehicle_registration' }], shared, drivers, companies).length, 2);
console.log('PDF image assignment checks passed');
