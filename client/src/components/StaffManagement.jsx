import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Eye, EyeOff, Users, Shield, Clock, Activity, Key } from 'lucide-react';
import axios from 'axios';

const STAFF_ROLES = {
  manager: {
    name: 'Manager',
    color: 'bg-purple-100 text-purple-800',
    icon: '👨‍💼',
    description: 'Full access to all features'
  },
  waiter: {
    name: 'Waiter',
    color: 'bg-blue-100 text-blue-800',
    icon: '🍽️',
    description: 'Take orders and serve customers'
  },
  kitchen: {
    name: 'Kitchen Staff',
    color: 'bg-orange-100 text-orange-800',
    icon: '👨‍🍳',
    description: 'Manage kitchen operations'
  }
};

export default function StaffManagement({ restaurantId }) {
  const [staff, setStaff] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [activeTab, setActiveTab] = useState('staff');
  const [toast, setToast] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  // PIN management
  const [pinModal, setPinModal] = useState(null);
  // Permissions editor
  const [permModal, setPermModal] = useState(null); // { staff }
  const [permLoading, setPermLoading] = useState(false);
  const [permEdit, setPermEdit] = useState({}); // { resource: { action: bool } }   // { staff, mode: 'set'|'reset' }
  const [pinStatus, setPinStatus] = useState({});   // { [staffId]: { hasPin, isLocked } }
  const [pinForm, setPinForm] = useState({ pin: '', confirmPin: '', adminPin: '' });
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: 'waiter'
  });

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (restaurantId) {
      fetchStaff();
      if (activeTab === 'activity') {
        fetchActivityLogs();
      }
    }
  }, [restaurantId, activeTab]);

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`/api/staff/restaurant/${restaurantId}`);
      setStaff(data);
      fetchPinStatuses(data);
    } catch (error) {
      console.error('Error fetching staff:', error);
      showToast('Failed to fetch staff members', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchActivityLogs = async () => {
    try {
      const { data } = await axios.get(`/api/staff/restaurant/${restaurantId}/activity`);
      setActivityLogs(data);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
    }
  };

  const fetchPinStatuses = async (staffList) => {
    const list = staffList || staff || [];
    if (list.length === 0) return;
    try {
      const results = await Promise.all(
        list.map(s => axios.get(`/api/pin/status/${s.id}`).then(r => [s.id, r.data]).catch(() => [s.id, {}]))
      );
      const map = {};
      results.forEach(([id, data]) => { map[id] = data; });
      setPinStatus(map);
    } catch (_) {}
  };

  const openPinModal = (staffMember, mode) => {
    setPinModal({ staff: staffMember, mode });
    setPinForm({ pin: '', confirmPin: '', adminPin: '', showPasswordField: false });
    setPinError('');
  };

  const handleRemovePin = async (staffMember) => {
    if (!window.confirm(`Remove PIN for ${staffMember.name}? They will need email/password to login.`)) return;
    try {
      await axios.post(`/api/staff/restaurant/${restaurantId}/reset-pin`, {
        staffId: staffMember.id,
        newPin: null,
      });
      showToast(`PIN removed for ${staffMember.name}`);
      setPinModal(null);
      await fetchPinStatuses();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to remove PIN', 'error');
    }
  };

  const openPermModal = (staffMember) => {
    // Start with staff's current DB permissions, fall back to role defaults
    const ROLE_DEFAULTS = {
      manager: { orders:{view:true,edit:true,delete:true}, menu:{view:true,edit:true,delete:true}, staff:{view:true,edit:true,delete:true}, analytics:{view:true}, settings:{view:true,edit:true}, history:{view:true}, discounts:{view:true,edit:true} },
      waiter:  { orders:{view:true,edit:true,delete:false}, menu:{view:true,edit:false,delete:false}, staff:{view:false,edit:false,delete:false}, analytics:{view:false}, settings:{view:false,edit:false}, history:{view:true}, discounts:{view:false,edit:false} },
      kitchen: { orders:{view:true,edit:true,delete:false}, menu:{view:true,edit:false,delete:false}, staff:{view:false,edit:false,delete:false}, analytics:{view:false}, settings:{view:false,edit:false}, history:{view:false}, discounts:{view:false,edit:false} },
    };
    const base = ROLE_DEFAULTS[staffMember.role] || ROLE_DEFAULTS.waiter;
    const current = (staffMember.permissions && Object.keys(staffMember.permissions).length > 0)
      ? staffMember.permissions
      : base;
    // Merge base with current so all resources are present
    const merged = {};
    for (const [res, actions] of Object.entries(base)) {
      merged[res] = { ...actions, ...(current[res] || {}) };
    }
    setPermEdit(merged);
    setPermModal({ staff: staffMember });
  };

  const savePermissions = async () => {
    if (!permModal) return;
    setPermLoading(true);
    try {
      await axios.put(
        `/api/staff/restaurant/${restaurantId}/staff/${permModal.staff.id}/permissions`,
        { permissions: permEdit }
      );
      showToast(`Permissions updated for ${permModal.staff.name}`);
      setPermModal(null);
      await fetchStaff(); // refresh list
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update permissions', 'error');
    } finally {
      setPermLoading(false);
    }
  };

  const handleSetPin = async () => {
    const { pin, confirmPin } = pinForm;
    if (!/^[0-9]{4,6}$/.test(pin)) { setPinError('PIN must be 4–6 digits'); return; }
    if (pin !== confirmPin) { setPinError('PINs do not match'); return; }
    setPinLoading(true); setPinError('');
    try {
      // Manager sets/resets PIN for any staff in their restaurant (no current PIN needed)
      await axios.post(`/api/staff/restaurant/${restaurantId}/reset-pin`, {
        staffId: pinModal.staff.id,
        newPin: pin,
      });
      showToast(`PIN ${pinModal.mode === 'set' ? 'set' : 'reset'} for ${pinModal.staff.name}`);
      setPinModal(null);
      await fetchPinStatuses();
    } catch (e) {
      // Fallback: use /api/pin/set with staff's current password
      if (pinForm.adminPin) {
        try {
          await axios.post('/api/pin/set', {
            staffId: pinModal.staff.id,
            pin,
            currentPassword: pinForm.adminPin,
          });
          showToast(`PIN set for ${pinModal.staff.name}`);
          setPinModal(null);
          await fetchPinStatuses();
        } catch (e2) {
          setPinError(e2.response?.data?.error || 'Failed to set PIN');
        }
      } else {
        setPinError(e.response?.data?.error || 'Failed — try providing the staff password below');
        setPinForm(f => ({ ...f, showPasswordField: true }));
      }
    } finally {
      setPinLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const isEdit = !!editingStaff;
    setConfirmModal({
      message: isEdit
        ? `Update ${formData.name}'s details?`
        : `Add ${formData.name} as ${formData.role}?`,
      confirmLabel: isEdit ? 'Update' : 'Add',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          if (isEdit) {
            const { data } = await axios.put(`/api/staff/restaurant/${restaurantId}/staff/${editingStaff.id}`, {
              name: formData.name,
              email: formData.email,
              phone: formData.phone,
              role: formData.role
            });
            setStaff(staff.map(s => s.id === editingStaff.id ? data : s));
            showToast('Staff member updated successfully');
          } else {
            const { data } = await axios.post('/api/staff', { restaurantId, ...formData });
            setStaff([data, ...staff]);
            showToast('Staff member added successfully');
          }
          setFormData({ name: '', email: '', phone: '', password: '', role: 'waiter' });
          setShowAddForm(false);
          setEditingStaff(null);
        } catch (error) {
          console.error('Error saving staff:', error);
          showToast(error.response?.data?.error || 'Failed to save staff member', 'error');
        }
      }
    });
  };

  const handleEdit = (staffMember) => {
    setEditingStaff(staffMember);
    setFormData({
      name: staffMember.name,
      email: staffMember.email,
      phone: staffMember.phone || '',
      password: '',
      role: staffMember.role
    });
    setShowAddForm(true);
  };

  const handleDelete = (staffId, staffName) => {
    setConfirmModal({
      message: `Delete ${staffName}? This action cannot be undone.`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await axios.delete(`/api/staff/restaurant/${restaurantId}/staff/${staffId}`);
          setStaff(staff.filter(s => s.id !== staffId));
          showToast('Staff member deleted successfully');
        } catch (error) {
          console.error('Error deleting staff:', error);
          showToast(error.response?.data?.error || 'Failed to delete staff member', 'error');
        }
      }
    });
  };

  const toggleStaffStatus = async (staffId, currentStatus) => {
    try {
      const { data } = await axios.put(`/api/staff/restaurant/${restaurantId}/staff/${staffId}`, {
        isActive: !currentStatus
      });
      
      setStaff(staff.map(s => s.id === staffId ? data : s));
    } catch (error) {
      console.error('Error updating staff status:', error);
      showToast('Failed to update staff status', 'error');
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getActivityIcon = (action) => {
    switch (action) {
      case 'login': return '🔐';
      case 'logout': return '🚪';
      case 'staff_added': return '➕';
      case 'staff_updated': return '✏️';
      case 'staff_deleted': return '🗑️';
      case 'password_changed': return '🔑';
      default: return '📝';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Loading staff...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Users className="w-6 h-6" />
              Staff Management
            </h2>
            <p className="text-gray-600">Manage your restaurant staff and permissions</p>
          </div>
          <button
            onClick={() => {
              setShowAddForm(true);
              setEditingStaff(null);
              setFormData({
                name: '',
                email: '',
                phone: '',
                password: '',
                role: 'waiter'
              });
            }}
            className="bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-dark flex items-center gap-2"
          >
            <Plus size={18} />
            Add Staff
          </button>
        </div>

        {/* Tabs */}
        <div className="flex space-x-4 border-b">
          <button
            onClick={() => setActiveTab('staff')}
            className={`pb-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'staff'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Staff Members ({staff.length})
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`pb-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'activity'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Activity Logs
          </button>
        </div>
      </div>

      {/* Staff List */}
      {activeTab === 'staff' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {staff.map((staffMember) => (
            <div key={staffMember.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center text-2xl">
                    {STAFF_ROLES[staffMember.role]?.icon || '👤'}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">{staffMember.name}</h3>
                    <p className="text-sm text-gray-600">{staffMember.email}</p>
                    {staffMember.phone && (
                      <p className="text-sm text-gray-600">{staffMember.phone}</p>
                    )}
                    {staffMember.role === 'waiter' && staffMember.waiter_number && (
                      <p className="text-sm font-semibold text-blue-600">
                        Waiter #{staffMember.waiter_number}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => toggleStaffStatus(staffMember.id, staffMember.is_active)}
                    className={`p-1 rounded ${
                      staffMember.is_active ? 'text-green-600' : 'text-gray-400'
                    }`}
                    title={staffMember.is_active ? 'Active' : 'Inactive'}
                  >
                    {staffMember.is_active ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    onClick={() => handleEdit(staffMember)}
                    className="p-1 text-blue-600 hover:text-blue-800"
                    title="Edit"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={() => openPermModal(staffMember)}
                    className="p-1 rounded transition-colors text-purple-500 hover:text-purple-700"
                    title="Edit permissions"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </button>
                  <button
                    onClick={() => openPinModal(staffMember, pinStatus[staffMember.id]?.hasPin ? 'reset' : 'set')}
                    className={`p-1 rounded transition-colors ${pinStatus[staffMember.id]?.hasPin ? 'text-green-600 hover:text-green-800' : 'text-gray-400 hover:text-orange-500'}`}
                    title={pinStatus[staffMember.id]?.hasPin ? 'PIN set — click to reset' : 'No PIN — click to set'}
                  >
                    <Key size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(staffMember.id, staffMember.name)}
                    className="p-1 text-red-600 hover:text-red-800"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Role:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    STAFF_ROLES[staffMember.role]?.color || 'bg-gray-100 text-gray-800'
                  }`}>
                    {STAFF_ROLES[staffMember.role]?.name || staffMember.role}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status:</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    staffMember.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {staffMember.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm text-gray-600">PIN Login:</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    pinStatus[staffMember.id]?.isLocked ? 'bg-red-100 text-red-700' :
                    pinStatus[staffMember.id]?.hasPin  ? 'bg-green-100 text-green-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {pinStatus[staffMember.id]?.isLocked ? 'Locked' :
                     pinStatus[staffMember.id]?.hasPin  ? 'Enabled' : 'Not set'}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  <div>Created: {formatDate(staffMember.created_at)}</div>
                  {staffMember.updated_at !== staffMember.created_at && (
                    <div>Updated: {formatDate(staffMember.updated_at)}</div>
                  )}
                </div>
              </div>

              {/* Permissions Preview */}
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-gray-500 font-medium">Permissions</span>
                  <button onClick={() => openPermModal(staffMember)}
                    className="text-xs text-purple-500 hover:text-purple-700 font-medium">Edit</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(staffMember.permissions && Object.keys(staffMember.permissions).length > 0
                    ? staffMember.permissions
                    : staffMember.roleDetails?.permissions || {}
                  ).map(([res, perms]) => (
                    <div key={res} className="flex items-center gap-0.5">
                      {perms.view && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">{res}</span>}
                      {perms.edit && <span className="bg-green-50 text-green-600 px-1.5 py-0.5 rounded text-[10px]">✎</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Activity Logs */}
      {activeTab === 'activity' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Activity
          </h3>
          
          <div className="space-y-3">
            {activityLogs.map((log) => (
              <div key={log.id} className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-2xl">{getActivityIcon(log.action)}</div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-medium">{log.staff_name}</span>
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      STAFF_ROLES[log.staff_role]?.color || 'bg-gray-100 text-gray-800'
                    }`}>
                      {STAFF_ROLES[log.staff_role]?.name || log.staff_role}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {log.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </div>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div className="text-xs text-gray-500 mt-1">
                      {JSON.stringify(log.details, null, 2)}
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock size={12} />
                  {formatDate(log.created_at)}
                </div>
              </div>
            ))}
            
            {activityLogs.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                No activity logs found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add/Edit Staff Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-gray-800">
                  {editingStaff ? 'Edit Staff Member' : 'Add New Staff Member'}
                </h2>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingStaff(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                {!editingStaff && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password *
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                      required={!editingStaff}
                      minLength="6"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role *
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  >
                    {Object.entries(STAFF_ROLES).map(([key, role]) => (
                      <option key={key} value={key}>
                        {role.icon} {role.name} - {role.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-primary text-white py-2 rounded-lg hover:bg-primary-dark font-semibold"
                  >
                    {editingStaff ? 'Update Staff' : 'Add Staff'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingStaff(null);
                    }}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium flex items-center gap-2 ${
          toast.type === 'error' ? 'bg-red-500' : 'bg-gray-900'
        }`}>
          {toast.type === 'error'
            ? <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            : <svg className="w-4 h-4 shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          }
          {toast.message}
        </div>
      )}

      {/* Confirm Modal */}
      {/* Permissions Editor Modal */}
      {permModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white px-6 pt-6 pb-3 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Edit Permissions</h2>
              <p className="text-sm text-gray-500 mt-0.5">{permModal.staff.name} · <span className="capitalize">{permModal.staff.role}</span></p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {[
                { key: 'orders',    label: 'Orders',    actions: ['view','edit','delete'] },
                { key: 'menu',      label: 'Menu',      actions: ['view','edit','delete'] },
                { key: 'history',   label: 'Order History', actions: ['view'] },
                { key: 'analytics', label: 'Analytics', actions: ['view'] },
                { key: 'staff',     label: 'Staff',     actions: ['view','edit','delete'] },
                { key: 'discounts', label: 'Discounts', actions: ['view','edit'] },
                { key: 'settings',  label: 'Settings',  actions: ['view','edit'] },
              ].map(({ key, label, actions }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm font-medium text-gray-700 w-32">{label}</span>
                  <div className="flex items-center gap-3">
                    {actions.map(action => (
                      <label key={action} className="flex items-center gap-1.5 cursor-pointer select-none">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={permEdit[key]?.[action] || false}
                            onChange={e => {
                              const val = e.target.checked;
                              setPermEdit(prev => {
                                const updated = { ...prev, [key]: { ...prev[key], [action]: val } };
                                // If edit/delete enabled, view must also be enabled
                                if ((action === 'edit' || action === 'delete') && val) {
                                  updated[key].view = true;
                                }
                                // If view disabled, disable edit and delete too
                                if (action === 'view' && !val) {
                                  updated[key] = { ...updated[key], edit: false, delete: false };
                                }
                                return updated;
                              });
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-4 h-4 border-2 border-gray-300 rounded peer-checked:bg-purple-500 peer-checked:border-purple-500 flex items-center justify-center">
                            {permEdit[key]?.[action] && (
                              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 capitalize">{action}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 px-6 pb-6 pt-2">
              <button onClick={() => setPermModal(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={savePermissions} disabled={permLoading}
                className="flex-1 py-2.5 bg-purple-500 text-white rounded-xl text-sm font-semibold hover:bg-purple-600 disabled:opacity-40">
                {permLoading ? 'Saving…' : 'Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Management Modal */}
      {pinModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              {pinModal.mode === 'set' ? 'Set PIN' : 'Reset PIN'} — {pinModal.staff.name}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {pinModal.mode === 'set'
                ? "Enter the staff member's current password to verify, then set a new PIN."
                : "Enter a new PIN for this staff member."}
            </p>

            {pinError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {pinError}
              </div>
            )}

            <div className="space-y-3">
              {(pinForm.showPasswordField) && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Staff's Current Password (required for first-time setup)
                  </label>
                  <input
                    type="password"
                    value={pinForm.adminPin}
                    onChange={e => setPinForm(f => ({ ...f, adminPin: e.target.value }))}
                    placeholder="Staff's current password"
                    autoFocus
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">The staff member's login password, not yours.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New PIN (4–6 digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinForm.pin}
                  onChange={e => setPinForm(f => ({ ...f, pin: e.target.value.replace(/[^0-9]/g,'').slice(0,6) }))}
                  placeholder="e.g. 1234"
                  maxLength={6}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinForm.confirmPin}
                  onChange={e => setPinForm(f => ({ ...f, confirmPin: e.target.value.replace(/[^0-9]/g,'').slice(0,6) }))}
                  placeholder="Repeat PIN"
                  maxLength={6}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setPinModal(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              {pinModal.mode === 'reset' && pinStatus[pinModal.staff.id]?.hasPin && (
                <button
                  onClick={() => handleRemovePin(pinModal.staff)}
                  className="py-2.5 px-3 border border-red-200 rounded-xl text-sm text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              )}
              <button
                onClick={handleSetPin}
                disabled={pinLoading || !pinForm.pin || !pinForm.confirmPin}
                className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600 disabled:opacity-40"
              >
                {pinLoading ? 'Saving…' : pinModal.mode === 'set' ? 'Set PIN' : 'Reset PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-2">Confirm Action</h3>
            <p className="text-gray-600 text-sm mb-6">{confirmModal.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white font-semibold hover:bg-red-600 transition-colors"
              >
                {confirmModal.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// end of file