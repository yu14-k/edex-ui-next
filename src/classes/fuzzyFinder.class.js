class FuzzyFinder {
    constructor() {
        if (document.getElementById("fuzzyFinder") || document.getElementById("settingsEditor")) {
            return false;
        }
        
        window.keyboard.detach();
        
        this.disp = new Modal({
            type: "custom",
            title: "Fuzzy cwd file search",
            html: `<input type="search" id="fuzzyFinder" placeholder="Search file in cwd..." />
                <ul id="fuzzyFinder-results">
                    <li class="fuzzyFinderMatchSelected"></li>
                    <li></li>
                    <li></li>
                    <li></li>
                    <li></li>
                </ul>`,
            buttons: [
                {label: "Select", action: () => { this.submit(); }}
            ]
        }, () => {
            delete window.activeFuzzyFinder;
            window.keyboard.attach();
            window.term[window.currentTerm].term.focus();
        });
        
        this.input = document.getElementById("fuzzyFinder");
        this.results = document.getElementById("fuzzyFinder-results");
        
        this.input.addEventListener('input', e => {
            if ((e.inputType && e.inputType.startsWith("delete")) || (e.detail && e.detail.startsWith("delete"))) {
                this.input.value = "";
                this.search("");
            } else {
                this.search(this.input.value);
            }
        });
        this.input.addEventListener('change', e => {
                if (e.detail === "enter") {
                    this.submit();
                }
        });
        this.input.addEventListener('keydown', e => {
            let selectedEl,selected,next,nextEl;
            switch(e.key) {
                case 'Enter':
                    this.submit();
                    e.preventDefault();
                    break;
                case 'ArrowDown':
                    selectedEl = document.querySelector('li.fuzzyFinderMatchSelected');
                    selected = Number(selectedEl.id.substr(17));
                    next = (document.getElementById(`fuzzyFinderMatch-${selected+1}`)) ? selected+1 : 0;
                    nextEl = document.getElementById(`fuzzyFinderMatch-${next}`);
                    selectedEl.removeAttribute("class");
                    nextEl.setAttribute("class", "fuzzyFinderMatchSelected");
                    e.preventDefault();
                    break;
                case 'ArrowUp':
                    selectedEl = document.querySelector('li.fuzzyFinderMatchSelected');
                    selected = Number(selectedEl.id.substr(17));
                    next = (document.getElementById(`fuzzyFinderMatch-${selected-1}`)) ? selected-1: 0;
                    nextEl = document.getElementById(`fuzzyFinderMatch-${next}`);
                    selectedEl.removeAttribute("class");
                    nextEl.setAttribute("class", "fuzzyFinderMatchSelected");
                    e.preventDefault();
                    break;
                default:
                    // Do nothing, input event will be triggered
            }
        });
        
        this.search("");
        this.input.focus();
    }

    search(text) {
           let files = window.fsDisp.cwd;
           let i = 0;
           let results = files.filter(file => {
               if (i >= 5 || file.type === "showDisks" || file.type === "up") {
                    return false;
                } else if (file.name.toLowerCase().includes(text.toLowerCase())) {
                    i++
                    return true;
                }
           });
           
           results.sort((a, b) => {
               if (a.name.toLowerCase().startsWith(text.toLowerCase()) && !b.name.toLowerCase().startsWith(text.toLowerCase())) {
                   return -1;
            } else if (!a.name.toLowerCase().startsWith(text.toLowerCase()) && b.name.toLowerCase().startsWith(text.toLowerCase())) {
                return 1;
            } else {
                return 0;
            }
           });
              
        if (results.length === 0) {
             this.results.innerHTML = `<li class="fuzzyFinderMatchSelected">No results</li>
                 <li></li>
                  <li></li>
                  <li></li>
                  <li></li>`;
         }
         // Clear results container (recreated below with text nodes, no HTML injection - #S1.3)
         while (this.results.firstChild) {
             this.results.removeChild(this.results.firstChild);
         }
         results.forEach((file, i) => {
             let li = document.createElement("li");
             li.setAttribute("id", "fuzzyFinderMatch-" + i);
             li.textContent = file.name;
             if (i === 0) li.setAttribute("class", "fuzzyFinderMatchSelected");
             li.addEventListener("click", () => {
                 let previouslySelected = this.results.querySelector("li.fuzzyFinderMatchSelected");
                 if (previouslySelected) previouslySelected.removeAttribute("class");
                 li.setAttribute("class", "fuzzyFinderMatchSelected");
                 document.getElementById("fuzzyFinder").focus();
             });
             this.results.appendChild(li);
         });
         for (let i = results.length; i < 5; i++) {
             let li = document.createElement("li");
             this.results.appendChild(li);
         }
      }
      submit() {
         let selected = document.querySelector("li.fuzzyFinderMatchSelected");
         let file = (selected) ? selected.textContent : "";
         if (file === "No results" || file.length <= 0) {
             this.disp.close();
             return;
        }
        
        let filePath = path.resolve(window.fsDisp.dirpath, file);
        
          window.term[window.currentTerm].write(`'${filePath}'`);
          this.disp.close();
     }
}

module.exports = {
    FuzzyFinder
};
