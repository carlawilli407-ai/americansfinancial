// External Transfer Page - Bank Selection Logic
(function() {
  // Top US Banks with SVG brand-color logos (no external image dependencies)
  const TOP_BANKS = [
    { id: 'chase', name: 'Chase Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23117aca%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ECHASE%3C/text%3E%3C/svg%3E' },
    { id: 'bankofamerica', name: 'Bank of America', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23d81d21%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EBANK%20OF%20AMERICA%3C/text%3E%3C/svg%3E' },
    { id: 'wellsfargo', name: 'Wells Fargo', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23ec2d2a%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EWELLS%20FARGO%3C/text%3E%3C/svg%3E' },
    { id: 'citibank', name: 'Citibank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%231e5799%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ECITI%3C/text%3E%3C/svg%3E' },
    { id: 'usbank', name: 'U.S. Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23003366%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EU.S.%20BANK%3C/text%3E%3C/svg%3E' },
    { id: 'pnc', name: 'PNC Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%230033a0%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EPNC%3C/text%3E%3C/svg%3E' },
    { id: 'truist', name: 'Truist', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%230072ce%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ETruist%3C/text%3E%3C/svg%3E' },
    { id: 'marcus', name: 'Marcus by Goldman Sachs', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%234a90a4%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EMARCUS%3C/text%3E%3C/svg%3E' },
    { id: 'tdbank', name: 'TD Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23488c3b%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ETD%20BANK%3C/text%3E%3C/svg%3E' },
    { id: 'capitalone', name: 'Capital One', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23ff5f00%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ECAPITAL%20ONE%3C/text%3E%3C/svg%3E' },
    { id: 'amex', name: 'American Express', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%230066cc%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EAMERICAN%20EXPRESS%3C/text%3E%3C/svg%3E' },
    { id: 'ally', name: 'Ally Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%2300a148%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EALLY%3C/text%3E%3C/svg%3E' },
    { id: 'discover', name: 'Discover', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23ed2226%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EDISCOVER%3C/text%3E%3C/svg%3E' },
    { id: 'morganstanley', name: 'Morgan Stanley', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%2300539a%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EMORGAN%20STANLEY%3C/text%3E%3C/svg%3E' },
    { id: 'fifththird', name: 'Fifth Third Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23005daa%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EFIFTH%20THIRD%3C/text%3E%3C/svg%3E' },
    { id: 'keybank', name: 'KeyBank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%2300457c%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EKEYBANK%3C/text%3E%3C/svg%3E' },
    { id: 'regions', name: 'Regions Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23c60020%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EREGIONS%3C/text%3E%3C/svg%3E' },
    { id: 'synchrony', name: 'Synchrony', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23005da6%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3ESYNCHRONY%3C/text%3E%3C/svg%3E' },
    { id: 'barclays', name: 'Barclays US', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%230054a6%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EBARCLAYS%3C/text%3E%3C/svg%3E' },
    { id: 'huntington', name: 'Huntington Bank', logo: 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20140%2050%22%3E%3Crect%20width=%22140%22%20height=%2250%22%20rx=%228%22%20fill=%22%23e31e24%22/%3E%3Ctext%20x=%2270%22%20y=%2233%22%20fill=%22%23fff%22%20font-family=%22Arial%2CHelvetica%2Csans-serif%22%20font-size=%2216%22%20font-weight=%22700%22%20text-anchor=%22middle%22%3EHUNTINGTON%3C/text%3E%3C/svg%3E' },
  ];

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function() {
    const bankGrid = document.getElementById('bankGrid');
    const transferForm = document.getElementById('transferForm');
    const formBankLogo = document.getElementById('form_bank_logo');
    const formBankName = document.getElementById('form_bank_name');
    const formBankNameDisplay = document.getElementById('form_bank_name_display');
    const bankOptions = document.querySelectorAll('.bank-option');

    if (!bankGrid) return;

    // Handle bank selection
    bankOptions.forEach(function(option) {
      option.addEventListener('click', function() {
        // Remove selected class from all
        bankOptions.forEach(function(opt) { opt.classList.remove('selected'); });
        
        // Add selected class to clicked
        this.classList.add('selected');
        
        // Get bank data
        const bankData = JSON.parse(this.dataset.bank);
        
        if (bankData.id === 'other') {
          // Show form with empty fields for manual entry
          formBankLogo.value = '';
          formBankName.value = '';
          formBankNameDisplay.value = '';
          formBankNameDisplay.readOnly = false;
          formBankNameDisplay.placeholder = 'Enter bank name';
        } else {
          // Pre-fill form with selected bank
          formBankLogo.value = bankData.logo;
          formBankName.value = bankData.name;
          formBankNameDisplay.value = bankData.name;
          formBankNameDisplay.readOnly = true;
        }
        
        // Show the transfer form
        transferForm.style.display = 'block';
        transferForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Routing number validation - only digits
    const routingInput = document.querySelector('input[name="routing"]');
    if (routingInput) {
      routingInput.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 9);
      });
    }

    // Account number formatting
    const accountNumberInput = document.querySelector('input[name="account_number"]');
    if (accountNumberInput) {
      accountNumberInput.addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '');
      });
    }
  });
})();
