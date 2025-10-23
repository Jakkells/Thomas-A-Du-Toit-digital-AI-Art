let iti = null;

export function initPhoneInput() {
  const el = document.getElementById('signupPhoneNumber');
  if (!el || !window.intlTelInput) return null;
  iti = window.intlTelInput(el, {
    initialCountry: 'za',
    separateDialCode: true,
    dropdownContainer: document.body // avoid clipping inside modal (overflow hidden)
  });
  return iti;
}

export const getFullNumber = () =>
  iti ? iti.getNumber() : (document.getElementById('signupPhoneNumber')?.value || '');

export const isValidNumber = () => (iti ? iti.isValidNumber() : true);