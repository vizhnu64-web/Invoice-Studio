/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { CustomerRecord } from '../types';

interface CustomersViewProps {
  customers: CustomerRecord[];
  onSaveCustomer: (customer: CustomerRecord) => Promise<void> | void;
  onDeleteCustomer: (customerId: string) => Promise<void> | void;
  isCloudConnected: boolean;
}

interface CustomerFormState {
  id: string;
  customerName: string;
  contactPerson: string;
  email: string;
  phone: string;
  gstin: string;
  pan: string;
  referenceNumber: string;
  billingAddress: string;
  shippingAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

const EMPTY_FORM: CustomerFormState = {
  id: '',
  customerName: '',
  contactPerson: '',
  email: '',
  phone: '',
  gstin: '',
  pan: '',
  referenceNumber: '',
  billingAddress: '',
  shippingAddress: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'India',
};

export const CustomersView: React.FC<CustomersViewProps> = ({
  customers,
  onSaveCustomer,
  onDeleteCustomer,
  isCloudConnected,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomerRecord | null>(null);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [
        c.customerName,
        c.contactPerson,
        c.email,
        c.phone,
        c.gstin,
        c.city,
        c.state,
        c.referenceNumber,
      ]
        .filter(Boolean)
        .some((val) => String(val).toLowerCase().includes(q))
    );
  }, [customers, searchQuery]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      referenceNumber: `CUST-${String(customers.length + 1).padStart(3, '0')}`,
    });
    setSameAsBilling(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditForm = (customer: CustomerRecord) => {
    setEditingId(customer.id);
    const billing = customer.billingAddress || '';
    const shipping = customer.shippingAddress || '';
    setSameAsBilling(!shipping || shipping === billing);
    setForm({
      id: customer.id,
      customerName: customer.customerName || '',
      contactPerson: customer.contactPerson || '',
      email: customer.email || '',
      phone: customer.phone || '',
      gstin: customer.gstin || '',
      pan: customer.pan || '',
      referenceNumber: customer.referenceNumber || '',
      billingAddress: billing,
      shippingAddress: shipping,
      city: customer.city || '',
      state: customer.state || '',
      postalCode: customer.postalCode || '',
      country: customer.country || 'India',
    });
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = form.customerName.trim();
    if (!trimmedName) {
      setFormError('Customer or business name is required.');
      return;
    }

    const trimmedEmail = form.email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Please enter a valid email address.');
      return;
    }

    const record: CustomerRecord = {
      id: editingId || `cust_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      customerName: trimmedName,
      contactPerson: form.contactPerson.trim() || undefined,
      email: trimmedEmail || undefined,
      phone: form.phone.trim() || undefined,
      gstin: form.gstin.trim().toUpperCase() || undefined,
      pan: form.pan.trim().toUpperCase() || undefined,
      referenceNumber: form.referenceNumber.trim() || undefined,
      billingAddress: form.billingAddress.trim(),
      shippingAddress: sameAsBilling
        ? form.billingAddress.trim()
        : form.shippingAddress.trim(),
      city: form.city.trim() || undefined,
      state: form.state.trim() || undefined,
      postalCode: form.postalCode.trim() || undefined,
      country: form.country.trim() || 'India',
      updatedAt: new Date().toISOString(),
    };

    setBusy(true);
    try {
      await onSaveCustomer(record);
      setNotice({
        type: 'success',
        text: editingId
          ? `Updated customer "${record.customerName}".`
          : `Added customer "${record.customerName}" to your directory.`,
      });
      closeForm();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save customer.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await onDeleteCustomer(pendingDelete.id);
      setNotice({
        type: 'success',
        text: `Deleted customer "${pendingDelete.customerName}".`,
      });
      setPendingDelete(null);
    } catch (err: any) {
      setNotice({
        type: 'error',
        text: err?.message || 'Failed to delete customer.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <Users className="w-6 h-6 text-indigo-600 shrink-0" />
            <span>Customer Directory</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono tabular-nums font-semibold text-slate-700">
              {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {isCloudConnected
                ? 'Saved in Google Drive (Invoice Studio/Application Data/customers.json)'
                : 'Stored in local browser workspace'}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateForm}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Add Customer</span>
        </button>
      </div>

      {/* Feedback Notice */}
      {notice && (
        <div
          role="status"
          className={`p-4 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notification"
            className="text-slate-500 hover:text-slate-800 p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search Bar & Customer Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search customers"
              placeholder="Search by name, contact, email, GSTIN, city, or reference..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Showing {filteredCustomers.length} of {customers.length}
          </p>
        </div>

        {filteredCustomers.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h2 className="text-sm font-bold text-slate-900">
                {customers.length === 0 ? 'No customers added yet' : 'No matching customers found'}
              </h2>
              <p className="text-xs text-slate-500">
                {customers.length === 0
                  ? 'Add your clients once to reuse their billing addresses, email addresses, and GSTIN across manual invoices and quotations.'
                  : 'Try adjusting your search keywords or add a new customer record.'}
              </p>
            </div>
            {customers.length === 0 && (
              <button
                type="button"
                onClick={openCreateForm}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Customer</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Customer / Company</th>
                  <th className="py-3 px-4">Contact Details</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Tax IDs</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <p className="font-bold text-slate-900">{customer.customerName}</p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                        {customer.contactPerson && <span>{customer.contactPerson}</span>}
                        {customer.contactPerson && customer.referenceNumber && (
                          <span aria-hidden="true">·</span>
                        )}
                        {customer.referenceNumber && (
                          <span className="font-mono">{customer.referenceNumber}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 space-y-1 text-slate-600">
                      {customer.email ? (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono text-[11px]">{customer.email}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400">No email</span>
                      )}
                      {customer.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-mono text-[11px] tabular-nums">
                            {customer.phone}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="flex items-start gap-1.5 max-w-xs">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="truncate">{customer.billingAddress || 'No address'}</p>
                          <p className="text-[11px] text-slate-500">
                            {[customer.city, customer.state, customer.postalCode]
                              .filter(Boolean)
                              .join(', ') || customer.country || ''}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700 space-y-0.5">
                      <div>GSTIN: {customer.gstin || '—'}</div>
                      <div className="text-slate-500">PAN: {customer.pan || '—'}</div>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditForm(customer)}
                          aria-label={`Edit ${customer.customerName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(customer)}
                          aria-label={`Delete ${customer.customerName}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Customer Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingId ? 'Edit Customer' : 'Add Customer'}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {editingId ? 'Edit Customer' : 'Add New Customer'}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                aria-label="Close customer form"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="cust-name"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Customer / Company Name *
                  </label>
                  <input
                    id="cust-name"
                    type="text"
                    required
                    value={form.customerName}
                    onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                    placeholder="Meridian Logistics Pvt Ltd"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cust-contact"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Primary Contact Person
                  </label>
                  <input
                    id="cust-contact"
                    type="text"
                    value={form.contactPerson}
                    onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                    placeholder="Ananya Verma"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cust-email"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Billing Email
                  </label>
                  <input
                    id="cust-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="accounts@meridian.example"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cust-phone"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Phone Number
                  </label>
                  <input
                    id="cust-phone"
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+91 98200 11223"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>

                <div>
                  <label
                    htmlFor="cust-gstin"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    GSTIN / Tax ID
                  </label>
                  <input
                    id="cust-gstin"
                    type="text"
                    value={form.gstin}
                    onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value }))}
                    placeholder="27AABCM1234F1Z9"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="cust-pan"
                      className="block font-semibold text-slate-700 mb-1"
                    >
                      PAN
                    </label>
                    <input
                      id="cust-pan"
                      type="text"
                      value={form.pan}
                      onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value }))}
                      placeholder="AABCM1234F"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="cust-ref"
                      className="block font-semibold text-slate-700 mb-1"
                    >
                      Reference Code
                    </label>
                    <input
                      id="cust-ref"
                      type="text"
                      value={form.referenceNumber}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, referenceNumber: e.target.value }))
                      }
                      placeholder="CUST-001"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="cust-billing-address"
                  className="block font-semibold text-slate-700 mb-1"
                >
                  Billing Address
                </label>
                <textarea
                  id="cust-billing-address"
                  rows={2}
                  value={form.billingAddress}
                  onChange={(e) => setForm((f) => ({ ...f, billingAddress: e.target.value }))}
                  placeholder="Street address, building, suite"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="cust-city" className="block font-semibold text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    id="cust-city"
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Mumbai"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div>
                  <label htmlFor="cust-state" className="block font-semibold text-slate-700 mb-1">
                    State
                  </label>
                  <input
                    id="cust-state"
                    type="text"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    placeholder="Maharashtra"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
                <div>
                  <label htmlFor="cust-postal" className="block font-semibold text-slate-700 mb-1">
                    Postal Code
                  </label>
                  <input
                    id="cust-postal"
                    type="text"
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    placeholder="400001"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="cust-country" className="block font-semibold text-slate-700 mb-1">
                    Country
                  </label>
                  <input
                    id="cust-country"
                    type="text"
                    value={form.country}
                    onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                    placeholder="India"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-slate-700 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => setSameAsBilling(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span>Shipping address same as billing address</span>
              </label>

              {!sameAsBilling && (
                <div>
                  <label
                    htmlFor="cust-shipping-address"
                    className="block font-semibold text-slate-700 mb-1"
                  >
                    Shipping Address
                  </label>
                  <textarea
                    id="cust-shipping-address"
                    rows={2}
                    value={form.shippingAddress}
                    onChange={(e) => setForm((f) => ({ ...f, shippingAddress: e.target.value }))}
                    placeholder="Delivery address"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                >
                  {busy ? 'Saving...' : editingId ? 'Save Changes' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Customer Deletion"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Delete Customer</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to remove{' '}
              <span className="font-bold text-slate-900">{pendingDelete.customerName}</span> from
              your customer directory? Existing saved invoices and quotations will not be affected.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {busy ? 'Deleting...' : 'Delete Customer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
