import assert from 'node:assert/strict';
import { validateAssignments } from '../repo-root/js/pdf-image-assignment.js';

const drivers = [{ id: 'driver-1', center_code: '001' }, { id: 'driver-2', center_code: '002' }];
const companies = [{ id: 'company-1', center_code: '001' }, { id: 'company-2', center_code: '002' }];
const assignment = { pageNumber: 1, selected: true, driverId: 'driver-1', center: '001', companyId: 'company-1', kind: 'identity', expiry: '' };
assert.equal(validateAssignments([assignment], drivers, companies).length, 1);
assert.throws(() => validateAssignments([{ ...assignment, selected: false }], drivers, companies), /페이지를 선택/);
assert.throws(() => validateAssignments([{ ...assignment, center: '002' }], drivers, companies), /센터가 일치/);
assert.throws(() => validateAssignments([{ ...assignment, companyId: 'company-2' }], drivers, companies), /운수사가 센터/);
assert.throws(() => validateAssignments([{ ...assignment, kind: 'health_certificate' }], drivers, companies), /만료일/);
assert.equal(validateAssignments([{ ...assignment, kind: 'health_certificate', expiry: '2027-02-28' }], drivers, companies).length, 1);
assert.throws(() => validateAssignments([assignment, { ...assignment, pageNumber: 2 }], drivers, companies), /여러 페이지/);
assert.equal(validateAssignments([assignment, { ...assignment, pageNumber: 2, kind: 'vehicle_registration' }], drivers, companies).length, 2);
console.log('PDF image assignment checks passed');
