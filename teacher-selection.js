// Wenn ein Lehrer angeklickt wird
document.querySelectorAll('.teacher-card').forEach(card => {
  card.addEventListener('click', function() {
    const teacherCode = this.getAttribute('data-code');
    const teacherName = this.getAttribute('data-name');
    
    // Speichere Lehrer-Daten im localStorage
    localStorage.setItem('selectedTeacherCode', teacherCode);
    localStorage.setItem('selectedTeacherName', teacherName);
    
    // Zur Podcast-App weiterleiten
    window.location.href = 'podcast-recorder.html';
  });
});

// Prüfe, ob bereits ein Lehrer ausgewählt wurde
window.addEventListener('DOMContentLoaded', function() {
  const savedTeacherCode = localStorage.getItem('selectedTeacherCode');
  const savedTeacherName = localStorage.getItem('selectedTeacherName');
  
  if (savedTeacherCode && savedTeacherName) {
    // Zur Podcast-App weiterleiten, wenn bereits ein Lehrer ausgewählt wurde
    window.location.href = 'podcast-recorder.html';
  }
});