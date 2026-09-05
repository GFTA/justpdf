package de.artur.justpdf.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import de.artur.justpdf.AppContainer
import de.artur.justpdf.JustPdfApp
import de.artur.justpdf.ui.home.HomeViewModel
import de.artur.justpdf.ui.settings.SettingsViewModel
import de.artur.justpdf.ui.viewer.ViewerViewModel

private val CreationExtras.container: AppContainer
    get() = (this[APPLICATION_KEY] as JustPdfApp).container

val AppViewModelFactory: ViewModelProvider.Factory = viewModelFactory {
    initializer { HomeViewModel(container) }
    initializer { SettingsViewModel(container) }
    initializer { ViewerViewModel(container, createSavedStateHandle()) }
}
