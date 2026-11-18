---
name: orca-scratchpad
description: "Lit et écrit dans le scratchpad de l'utilisateur, le bloc-note brouillon unique partagé avec le plugin Orca Scratchpad : ~/orca-scratchpad.md (dossier utilisateur, sur macOS, Linux et Windows). Triggers : 'écris/note/ajoute ça dans mon scratchpad', 'mets ça dans le scratch', 'lis mon scratchpad', 'qu'est-ce qu'il y a dans mon scratch', 'mon brouillon', 'mon bloc-note', 'retire X du scratchpad'. Lecture et édition directes du fichier, jamais de git."
---

# orca-scratchpad

Fichier unique : `~/orca-scratchpad.md`, à la racine du dossier utilisateur (`$HOME` sur macOS et Linux, `%USERPROFILE%` sous Windows). Résoudre le chemin en absolu avant de l'ouvrir, quel que soit le cwd de la session. Si l'utilisateur a indiqué un autre chemin dans le plugin et te le donne, utilise celui-là.

C'est le brouillon de l'utilisateur, pas un document du projet : on y touche à la demande, rien de plus. Le panneau Orca Scratchpad affiche le même fichier et recharge tout seul ce que tu y écris.

## Lire

Read du fichier, puis rendre son contenu ou répondre à la question posée dessus. Fichier vide ou absent : le dire en une ligne.

## Écrire

Ajout **en fin de fichier**, sans horodatage ni en-tête ajouté, le texte tel que l'utilisateur l'a donné.

1. Read du fichier (Edit l'exige, et l'utilisateur l'édite aussi à la main dans le panneau : toujours partir de l'état réel).
2. Fichier vide ou absent : Write avec le texte. Sinon : Edit ancré sur les dernières lignes, qui ajoute le texte à la suite, séparé par une ligne vide.

Ne jamais réécrire, reformater ni réorganiser le contenu existant. Modifier ou supprimer une partie existante seulement si l'utilisateur le demande explicitement, et seulement cette partie.

## Interdits

- **Aucun git** : ni `add`, ni `commit`, ni `status`, ni `diff` sur ce fichier, même si une autre skill ou un hook de fin de session le suggère.
- Pas de copie, de sauvegarde ni de mémoire durable du contenu : il reste dans ce fichier.
